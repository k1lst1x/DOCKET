"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RecordDialog } from "@/components/records/RecordDialog";
import { formatDate, formatNumber, plural } from "@/lib/format";
import type { CityProject, NeighborhoodActivity, ProjectKind, ResidentReport, SafetyAlert } from "@/lib/neighborhood-activity";

// Group-page sections built from the reading agent's records for one neighborhood: what residents filed on
// the Fremont App, the city's projects and development sites there, and the latest police and city alerts.
// Every card opens the record in its own popup (charts, map, related records, neighbor reviews); the open
// record is kept in the URL (?record=) so it can be shared and the back button closes it.

const REPORT_A_PROBLEM = "https://fremontca.citysourced.com/servicerequests/create";
const RECORD_PARAM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KIND_LABEL: Record<ProjectKind, string> = {
  capital: "Capital project",
  street: "Street maintenance",
  transportation: "Transportation",
  development: "Development",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today", "Yesterday", "5 days ago", then a date. */
export function whenLabel(iso: string, now: number): string {
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}

/** "Filed today", "Filed 3 days ago", "Filed on Sep 2, 2026". */
function filedLabel(iso: string, now: number): string {
  const label = whenLabel(iso, now);
  if (label === "Today" || label === "Yesterday") return label.toLowerCase();
  return label.endsWith("ago") ? label : `on ${label}`;
}

const readRecordParam = () => {
  const id = new URLSearchParams(window.location.search).get("record");
  return id && RECORD_PARAM.test(id) ? id : null;
};

export function NeighborhoodActivitySections({ name, activity, now }: { name: string; activity: NeighborhoodActivity; now: number }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [fallbackTitle, setFallbackTitle] = useState<string | undefined>();
  // True when opening pushed a history entry, so closing can step back instead of leaving the page.
  const pushed = useRef(false);

  useEffect(() => {
    const sync = () => setOpenId(readRecordParam());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const open = useCallback((id: string, title?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("record", id);
    if (readRecordParam()) {
      window.history.replaceState({ ...window.history.state, docketRecord: id }, "", url);
    } else {
      window.history.pushState({ ...window.history.state, docketRecord: id }, "", url);
      pushed.current = true;
    }
    setFallbackTitle(title);
    setOpenId(id);
  }, []);

  const close = useCallback(() => {
    if (!readRecordParam()) return setOpenId(null);
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete("record");
      window.history.replaceState(window.history.state, "", url);
      setOpenId(null);
    }
  }, []);

  return (
    <>
      <ReportsSection name={name} activity={activity} now={now} onOpen={open} />
      <ProjectsSection name={name} activity={activity} onOpen={open} />
      {activity.alerts.length ? <AlertsSection alerts={activity.alerts} now={now} onOpen={open} /> : null}
      <RecordDialog recordId={openId} onClose={close} onOpen={(id) => open(id)} fallbackTitle={fallbackTitle} />
    </>
  );
}

type OpenRecord = (id: string, title?: string) => void;

function SectionHeading({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id} className="display mt-2 text-[2.25rem] leading-tight sm:text-[2.75rem]">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}

const cardButton =
  "group flex h-full w-full flex-col rounded-2xl border border-rule p-5 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-ink/40 hover:shadow-[0_8px_24px_rgba(38,38,38,0.08)]";

function ExploreHint() {
  return (
    <span aria-hidden="true" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-ink group-hover:underline group-hover:underline-offset-4">
      Explore
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5">
        <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function ReportsSection({ name, activity, now, onOpen }: { name: string; activity: NeighborhoodActivity; now: number; onOpen: OpenRecord }) {
  const { reports, reportsLast30Days, reportsTotal, openReports } = activity;
  return (
    <section aria-labelledby="neighborhood-reports" className="border-t border-rule bg-sky-mist">
      <div className="page py-14 sm:py-20">
        <SectionHeading id="neighborhood-reports" eyebrow="Reported to the city" title="What neighbors are reporting">
          <a href={REPORT_A_PROBLEM} target="_blank" rel="noopener noreferrer" className="btn btn-secondary h-11 rounded-full px-5">
            Report a problem
            <span className="sr-only"> on the Fremont App (opens in a new tab)</span>
          </a>
        </SectionHeading>
        <p className="mt-3 max-w-read text-base text-ink-soft">
          {reportsTotal ? (
            <>
              {plural(reportsLast30Days, "request")} filed from {name} on the Fremont App in the last 30 days. {formatNumber(reportsTotal)} on file in all
              {openReports ? `, ${formatNumber(openReports)} still open` : ""}. Open one to see the map, how often it comes up here and what neighbors say.
            </>
          ) : (
            <>No Fremont App requests from {name} on file yet. Potholes, graffiti, broken streetlights and dumping reported here show up the next morning.</>
          )}
        </p>
        {reports.length ? (
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {reports.map((report) => (
              <li key={report.id}>
                <ReportCard report={report} now={now} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function ReportCard({ report, now, onOpen }: { report: ResidentReport; now: number; onOpen: OpenRecord }) {
  return (
    <button type="button" onClick={() => onOpen(report.id, report.category)} className={`${cardButton} bg-white`}>
      <span className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${report.open ? "bg-ochre-wash text-ochre" : "bg-park-wash text-park"}`}>
          {report.open ? "Open" : "Closed"}
        </span>
        {report.reportedAt ? (
          <time dateTime={report.reportedAt} className="text-sm text-ink-muted">
            Filed {filedLabel(report.reportedAt, now)}
          </time>
        ) : null}
      </span>
      <span className="mt-2 block text-lg font-semibold leading-snug text-ink">{report.category}</span>
      {report.address ? (
        <span className="mt-1 block text-base text-ink-soft">{report.address.replace(/,\s*Fremont,?\s*CA\b\s*/i, ", ").replace(/,\s*$/, "")}</span>
      ) : null}
      {report.description ? <span className="mt-2 block text-base leading-relaxed text-ink">“{report.description}”</span> : null}
      <span className="mt-auto block pt-3">
        {report.status ? <span className="block text-sm text-ink-muted">Status: {report.status}</span> : null}
        {report.caseNumber ? <span className="block text-sm text-ink-muted">{report.caseNumber}</span> : null}
        <ExploreHint />
      </span>
    </button>
  );
}

function ProjectsSection({ name, activity, onOpen }: { name: string; activity: NeighborhoodActivity; onOpen: OpenRecord }) {
  const { projects, projectsTotal, development, developmentTotal } = activity;
  return (
    <section aria-labelledby="neighborhood-projects" className="border-t border-rule bg-white">
      <div className="page py-14 sm:py-20">
        <SectionHeading id="neighborhood-projects" eyebrow="Built and planned" title="City projects on these streets" />
        <p className="mt-3 max-w-read text-base text-ink-soft">
          {projectsTotal || developmentTotal ? (
            <>
              {plural(projectsTotal, "city project")} and {plural(developmentTotal, "development site")} mapped in {name}, from the City of
              Fremont&apos;s public GIS layers.
            </>
          ) : (
            <>The City of Fremont&apos;s public GIS layers don&apos;t map any projects or development sites in {name}.</>
          )}
        </p>
        {projects.length ? (
          <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectCard project={project} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        ) : null}
        {projectsTotal > projects.length ? (
          <p className="mt-4 text-sm text-ink-muted">Showing {projects.length} of {formatNumber(projectsTotal)}. Ask Docket about the rest.</p>
        ) : null}
        {development.length ? (
          <div className="mt-12">
            <h3 className="text-xl font-semibold text-ink">Development sites</h3>
            <ul className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {development.map((project) => (
                <li key={project.id}>
                  <ProjectCard project={project} onOpen={onOpen} />
                </li>
              ))}
            </ul>
            {developmentTotal > development.length ? (
              <p className="mt-4 text-sm text-ink-muted">Showing {development.length} of {formatNumber(developmentTotal)}.</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProjectCard({ project, onOpen }: { project: CityProject; onOpen: OpenRecord }) {
  return (
    <button type="button" onClick={() => onOpen(project.id, project.title)} className={`${cardButton} bg-sky-mist/40`}>
      <span className="eyebrow block">{KIND_LABEL[project.kind]}</span>
      <span className="mt-1 block text-lg font-semibold leading-snug text-ink">{project.title}</span>
      {project.location ? <span className="mt-1 block text-base text-ink-soft">{project.location}</span> : null}
      {project.description ? <span className="mt-2 block text-base leading-relaxed text-ink">{project.description}</span> : null}
      <span className="mt-auto block pt-3">
        {/* Development sites carry the city's short status code (APV, BPR, OPC, PRP, UC); the layer doesn't define
            them, so they're shown as recorded rather than guessed. The project layers only have free-text notes. */}
        {project.status ? (
          <span className="block text-sm text-ink-muted">
            {project.kind === "development" ? "City status code" : "Notes"}: {project.status}
          </span>
        ) : null}
        {project.facts.length ? <span className="block text-sm text-ink-muted">{project.facts.join(" · ")}</span> : null}
        <ExploreHint />
      </span>
    </button>
  );
}

function AlertsSection({ alerts, now, onOpen }: { alerts: SafetyAlert[]; now: number; onOpen: OpenRecord }) {
  return (
    <section aria-labelledby="neighborhood-alerts" className="border-t border-rule bg-sky-mist">
      <div className="page py-14 sm:py-20">
        <SectionHeading id="neighborhood-alerts" eyebrow="For all of Fremont" title="Police and city alerts" />
        <ul className="mt-8 divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-white">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <button type="button" onClick={() => onOpen(alert.id, alert.title)} className="group block w-full p-5 text-left hover:bg-sky-mist/60 sm:p-6">
                <span className="block text-sm text-ink-muted">{[alert.agency, alert.postedAt ? whenLabel(alert.postedAt, now) : null].filter(Boolean).join(" · ")}</span>
                <span className="mt-1 block text-lg font-semibold leading-snug text-ink group-hover:underline group-hover:underline-offset-4">{alert.title}</span>
                {alert.excerpt ? <span className="mt-1 block text-base text-ink-soft">{alert.excerpt}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
