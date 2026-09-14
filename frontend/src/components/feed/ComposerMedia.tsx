"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatDuration, MAX_IMAGES, MAX_VIDEO_SECONDS, maxBytes, MEDIA_TYPES, type PostMediaKind } from "@/lib/post-media";

// Photos, a video and emoji for the post box. Files upload as soon as they're picked, straight to
// Docket's media bucket with a one-time ticket from /api/posts/media, so posting is instant.

export interface Attachment {
  id: string;
  kind: PostMediaKind;
  contentType: string;
  previewUrl: string;
  width: number | null;
  height: number | null;
  durationS: number | null;
  progress: number;
  status: "uploading" | "ready" | "failed";
  key: string | null;
}

const MB = 1024 * 1024;

const UPLOAD_ERRORS: Record<string, string> = {
  not_signed_in: "Your sign-in has expired. Sign in again to add photos or videos.",
  busy: "You're adding files quickly. Wait a minute, then try again.",
  media_invalid: "Docket can't take that file.",
  media_unavailable: "Photo and video uploads aren't available right now.",
};

function measure(kind: PostMediaKind, url: string): Promise<{ width: number; height: number; durationS: number | null }> {
  return new Promise((resolve, reject) => {
    if (kind === "image") {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, durationS: null });
      img.onerror = () => reject(new Error("That photo couldn't be opened."));
      img.src = url;
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) reject(new Error("Docket couldn't read how long that video is. Try saving it as an MP4."));
      else resolve({ width: video.videoWidth, height: video.videoHeight, durationS: video.duration });
    };
    video.onerror = () => reject(new Error("This browser can't open that video. Try an MP4."));
    video.src = url;
  });
}

function upload(file: File, contentType: string, durationS: number | null, onProgress: (pct: number) => void): Promise<string> {
  return (async () => {
    const res = await fetch("/api/posts/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType, size: file.size, durationS }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !data?.url) throw new Error(UPLOAD_ERRORS[(data as { error?: string } | null)?.error ?? ""] ?? "That upload didn't start. Try again.");
    const ticket = data as { url: string; fields: Record<string, string>; key: string };

    const form = new FormData();
    for (const [name, value] of Object.entries(ticket.fields)) form.append(name, value);
    form.append("file", file);
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", ticket.url);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("The upload didn't finish. Try again.")));
      xhr.onerror = () => reject(new Error("The upload didn't finish. Check your connection and try again."));
      xhr.send(form);
    });
    return ticket.key;
  })();
}

/** Picked files, their uploads, and what the post should send. */
export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => () => itemsRef.current.forEach((a) => URL.revokeObjectURL(a.previewUrl)), []);

  const patch = useCallback((id: string, change: Partial<Attachment>) => setItems((list) => list.map((a) => (a.id === id ? { ...a, ...change } : a))), []);

  const add = useCallback(
    async (files: File[]) => {
      setError(null);
      if (!files.length) return;
      const current = itemsRef.current;
      const kinds = files.map((f) => MEDIA_TYPES[f.type]?.kind);
      if (kinds.some((k) => !k)) return setError("Photos can be JPEG, PNG, WebP or GIF. Videos can be MP4, WebM or MOV.");
      const hasVideo = kinds.includes("video") || current.some((a) => a.kind === "video");
      if (hasVideo && current.length + files.length > 1) return setError(`A post can have one video, or up to ${MAX_IMAGES} photos.`);
      if (current.length + files.length > MAX_IMAGES) return setError(`A post can have up to ${MAX_IMAGES} photos.`);
      const tooBig = files.find((f) => f.size > maxBytes(MEDIA_TYPES[f.type].kind));
      if (tooBig) {
        const kind = MEDIA_TYPES[tooBig.type].kind;
        return setError(kind === "video" ? `Videos can be up to ${maxBytes("video") / MB} MB.` : `Photos can be up to ${maxBytes("image") / MB} MB each.`);
      }

      for (const file of files) {
        const { kind } = MEDIA_TYPES[file.type];
        const previewUrl = URL.createObjectURL(file);
        let size: Awaited<ReturnType<typeof measure>>;
        try {
          size = await measure(kind, previewUrl);
        } catch (e) {
          URL.revokeObjectURL(previewUrl);
          setError((e as Error).message);
          continue;
        }
        if (kind === "video" && (size.durationS ?? 0) > MAX_VIDEO_SECONDS) {
          URL.revokeObjectURL(previewUrl);
          setError(`Videos can be up to 5 minutes long. That one is ${formatDuration(size.durationS ?? 0)}.`);
          continue;
        }
        const item: Attachment = { id: crypto.randomUUID(), kind, contentType: file.type, previewUrl, ...size, progress: 0, status: "uploading", key: null };
        setItems((list) => [...list, item]);
        upload(file, file.type, size.durationS, (progress) => patch(item.id, { progress }))
          .then((key) => patch(item.id, { key, status: "ready", progress: 100 }))
          .catch((e: Error) => {
            patch(item.id, { status: "failed" });
            setError(e.message);
          });
      }
    },
    [patch],
  );

  const remove = useCallback((id: string) => {
    const gone = itemsRef.current.find((a) => a.id === id);
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    setItems((list) => list.filter((a) => a.id !== id));
    setError(null);
  }, []);

  const clear = useCallback(() => {
    itemsRef.current.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setItems([]);
    setError(null);
  }, []);

  const uploading = items.some((a) => a.status === "uploading");
  const failed = items.some((a) => a.status === "failed");
  const media = items
    .filter((a) => a.status === "ready" && a.key)
    .map((a) => ({ key: a.key, contentType: a.contentType, width: a.width, height: a.height, durationS: a.durationS }));

  return { items, error, add, remove, clear, uploading, failed, media, canAddMore: !items.some((a) => a.kind === "video") && items.length < MAX_IMAGES };
}

export function AttachmentPreviews({ items, onRemove }: { items: Attachment[]; onRemove: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <ul aria-label="Attached photos and videos" className={`mt-2 grid gap-2 ${items.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
      {items.map((a, i) => (
        <li key={a.id} className="relative overflow-hidden rounded-xl border border-rule bg-sky-mist">
          {a.kind === "video" ? (
            <video src={a.previewUrl} controls playsInline muted preload="metadata" className="block max-h-80 w-full bg-black" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of a file being uploaded.
            <img src={a.previewUrl} alt={`Attached photo ${i + 1}`} className={`block w-full object-cover ${items.length === 1 ? "max-h-80" : "h-36 sm:h-44"}`} />
          )}
          {a.durationS ? (
            <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 font-mono text-xs text-white">{formatDuration(a.durationS)}</span>
          ) : null}
          {a.status !== "ready" ? (
            <span
              role="status"
              className={`absolute inset-x-0 top-0 px-2.5 py-1 text-xs font-semibold ${a.status === "failed" ? "bg-signal text-white" : "bg-ink/75 text-white"}`}
            >
              {a.status === "failed" ? "Upload failed. Remove it and try again." : `Uploading ${a.progress}%`}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            aria-label={`Remove ${a.kind === "video" ? "video" : `photo ${i + 1}`}`}
            className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-ink/80 text-lg leading-none text-white hover:bg-ink"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AttachButton({ onFiles, disabled, accept, multiple }: { onFiles: (files: File[]) => void; disabled: boolean; accept: string; multiple: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        title="Add photos or a video"
        className="grid h-10 w-10 place-items-center rounded-full text-park hover:bg-sky-mist disabled:opacity-40"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
          <rect x="2.5" y="4" width="15" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="7.2" cy="8.3" r="1.5" fill="currentColor" />
          <path d="M3 14l4.5-4 3.5 3 2.5-2 3.5 3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
        <span className="sr-only">Add photos or a video</span>
      </button>
    </>
  );
}

const EMOJI: [string, string][] = [
  ["😀", "grinning"], ["😂", "laughing"], ["😊", "smiling"], ["😍", "heart eyes"], ["🥳", "party"], ["😎", "cool"],
  ["🤔", "thinking"], ["😮", "surprised"], ["😢", "sad"], ["😡", "angry"], ["🙏", "thank you"], ["👏", "clapping"],
  ["👍", "thumbs up"], ["👎", "thumbs down"], ["💪", "strong"], ["🙌", "hooray"], ["👋", "wave"], ["❤️", "heart"],
  ["🔥", "fire"], ["✨", "sparkles"], ["🎉", "celebrate"], ["✅", "done"], ["⚠️", "warning"], ["❗", "important"],
  ["📍", "pin"], ["🏡", "home"], ["🏙️", "city"], ["🌳", "park"], ["🌸", "flowers"], ["☀️", "sunny"],
  ["🌧️", "rain"], ["🚗", "car"], ["🚲", "bike"], ["🚌", "bus"], ["🚧", "roadwork"], ["🚨", "alert"],
  ["🐶", "dog"], ["🐱", "cat"], ["🍕", "pizza"], ["☕", "coffee"], ["🛒", "shopping"], ["📚", "books"],
  ["⚽", "soccer"], ["🎶", "music"], ["📸", "camera"], ["🗳️", "vote"], ["🏛️", "city hall"], ["💡", "idea"],
];

/** Emoji button with a small picker; picking inserts the emoji where the cursor is. */
export function EmojiButton({ onPick, align = "left" }: { onPick: (emoji: string) => void; align?: "left" | "right" }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-emoji`}
        onClick={() => setOpen((o) => !o)}
        title="Add an emoji"
        className="grid h-10 w-10 place-items-center rounded-full text-park hover:bg-sky-mist"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
          <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="7.3" cy="8.3" r="1.1" fill="currentColor" />
          <circle cx="12.7" cy="8.3" r="1.1" fill="currentColor" />
          <path d="M6.6 11.8a4 4 0 0 0 6.8 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <span className="sr-only">Add an emoji</span>
      </button>
      {open ? (
        <div
          id={`${id}-emoji`}
          role="group"
          aria-label="Emoji"
          className={`absolute bottom-12 z-20 grid w-[17.5rem] max-w-[calc(100vw-3rem)] grid-cols-6 gap-0.5 rounded-2xl border border-rule bg-white p-2 shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
        >
          {EMOJI.map(([emoji, name]) => (
            <button
              key={emoji}
              type="button"
              aria-label={name}
              title={name}
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
              className="grid h-10 place-items-center rounded-lg text-[1.35rem] leading-none hover:bg-sky-mist"
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Inserts text at a textarea's cursor and puts the cursor after it. */
export function insertAtCursor(el: HTMLTextAreaElement | null, value: string, insert: string, setValue: (v: string) => void) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  setValue(value.slice(0, start) + insert + value.slice(end));
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(start + insert.length, start + insert.length);
  });
}
