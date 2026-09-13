// Flat illustration of a green San Francisco park below a row of Painted Ladies.
// Drawn in SVG so it stays sharp at any width and costs nothing to load.
// The sky is left transparent: the page's gradient shows through.

const HOUSE_COLORS = ["#A9C6E8", "#F2E3C6", "#B9D3C0", "#F4C9C0", "#E8D7A8", "#C9B8E0", "#F7F1E3"];

function cypress(cx: number, top: number, bottom: number, w: number) {
  const h = bottom - top;
  return `M${cx - w} ${bottom} C ${cx - w * 1.1} ${bottom - h * 0.45} ${cx - w * 0.6} ${top + h * 0.2} ${cx} ${top} C ${cx + w * 0.6} ${top + h * 0.2} ${cx + w * 1.1} ${bottom - h * 0.45} ${cx + w} ${bottom} Z`;
}

function House({ x, color }: { x: number; color: string }) {
  return (
    <g>
      <rect x={x} y={309} width={58} height={90} fill={color} />
      <polygon points={`${x - 3},311 ${x + 29},266 ${x + 61},311`} fill="#5C5552" />
      <polygon points={`${x + 9},307 ${x + 29},281 ${x + 49},307`} fill={color} stroke="#FFFFFF" strokeWidth={2} />
      <rect x={x + 5} y={320} width={24} height={52} fill="#FFFFFF" opacity={0.9} />
      <rect x={x + 9} y={325} width={16} height={18} fill="#6F8FA8" />
      <rect x={x + 9} y={349} width={16} height={18} fill="#6F8FA8" />
      <rect x={x + 35} y={323} width={16} height={20} fill="#6F8FA8" stroke="#FFFFFF" strokeWidth={2} />
      <rect x={x + 36} y={356} width={14} height={34} fill="#7A5A48" />
      <rect x={x + 32} y={389} width={22} height={9} fill="#FFFFFF" opacity={0.75} />
    </g>
  );
}

export function HeroIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1600 640" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false" className={className}>
      {/* Low clouds */}
      <g fill="#FFFFFF">
        <ellipse cx="180" cy="336" rx="170" ry="36" opacity="0.9" />
        <ellipse cx="300" cy="310" rx="110" ry="44" opacity="0.9" />
        <ellipse cx="80" cy="318" rx="80" ry="30" opacity="0.9" />
        <ellipse cx="1390" cy="300" rx="190" ry="40" opacity="0.9" />
        <ellipse cx="1280" cy="280" rx="104" ry="42" opacity="0.9" />
        <ellipse cx="1510" cy="286" rx="92" ry="34" opacity="0.9" />
        <ellipse cx="820" cy="300" rx="150" ry="22" opacity="0.6" />
      </g>

      {/* Distant hills */}
      <path d="M0 384 C 200 344 380 352 560 374 S 900 392 1100 362 S 1450 330 1600 350 V640 H0Z" fill="#A6D27F" />

      {/* Dark pine behind the row */}
      <path d={cypress(1100, 250, 400, 34)} fill="#2F5A2A" />
      <path d={cypress(540, 280, 400, 26)} fill="#35632D" />

      {/* Painted Ladies */}
      {HOUSE_COLORS.map((color, i) => (
        <House key={color} x={600 + i * 62} color={color} />
      ))}

      {/* Trees framing the houses */}
      <circle cx="582" cy="372" r="36" fill="#4E9A3A" />
      <circle cx="552" cy="390" r="26" fill="#6DB33F" />
      <circle cx="1060" cy="366" r="42" fill="#3F8A35" />
      <circle cx="1104" cy="384" r="30" fill="#6DB33F" />

      {/* Main lawn */}
      <path d="M0 432 C 240 402 520 394 760 404 S 1180 420 1600 330 V640 H0Z" fill="#7CC04F" />
      <path d="M0 444 C 60 404 170 398 270 424 S 390 466 430 506 V640 H0Z" fill="#3F7F2E" />

      {/* Right hillside, rising like the reference */}
      <path d="M820 640 C 980 520 1200 432 1600 378 V640Z" fill="#5DAA3C" />

      {/* Right shade tree */}
      <path d="M1440 470 C 1434 424 1418 386 1396 356" stroke="#6B4A2E" strokeWidth="10" fill="none" strokeLinecap="round" />
      <ellipse cx="1384" cy="334" rx="74" ry="46" fill="#5DAA3C" />
      <ellipse cx="1446" cy="318" rx="62" ry="40" fill="#4E9A3A" />
      <ellipse cx="1336" cy="350" rx="50" ry="30" fill="#8CC63F" />

      {/* People on the far hill */}
      <g fill="#262626">
        <rect x="1188" y="420" width="6" height="16" rx="3" />
        <rect x="1200" y="418" width="6" height="18" rx="3" />
        <circle cx="1191" cy="415" r="4" />
        <circle cx="1203" cy="413" r="4" />
      </g>

      {/* Cypress row on the left */}
      <path d={cypress(60, 330, 620, 34)} fill="#2F4A1E" />
      <path d={cypress(132, 290, 610, 40)} fill="#3A5A24" />
      <path d={cypress(214, 350, 600, 32)} fill="#2F4A1E" />
      <path d={cypress(300, 400, 590, 26)} fill="#446B2A" />

      {/* Round trees mid-left */}
      <circle cx="430" cy="446" r="60" fill="#5DAA3C" />
      <circle cx="510" cy="462" r="48" fill="#8CC63F" />
      <circle cx="370" cy="478" r="44" fill="#4E9A3A" />

      {/* Flower beds */}
      <ellipse cx="340" cy="556" rx="84" ry="16" fill="#F2C94C" />
      <ellipse cx="478" cy="566" rx="70" ry="14" fill="#C9A8E6" />

      {/* Winding path */}
      <path
        d="M180 640 C 260 592 420 562 640 550 C 820 540 980 522 1060 472 L 1092 476 C 1012 542 862 568 662 582 C 472 594 332 614 300 640Z"
        fill="#EAD9B8"
      />

      {/* Lamp posts */}
      <g stroke="#262626" strokeWidth="3" strokeLinecap="round">
        <path d="M568 470 V540" />
        <path d="M948 452 V514" />
      </g>
      <circle cx="568" cy="468" r="5" fill="#262626" />
      <circle cx="948" cy="450" r="5" fill="#262626" />

      {/* Pond and fountain */}
      <ellipse cx="770" cy="598" rx="132" ry="26" fill="#9FD0F2" />
      <ellipse cx="770" cy="598" rx="100" ry="15" fill="#C4E3F7" />
      <ellipse cx="770" cy="592" rx="26" ry="7" fill="#FFFFFF" />
      <path d="M770 592 C 761 574 765 558 770 548 C 775 558 779 574 770 592Z" fill="#FFFFFF" opacity="0.9" />

      {/* Two cyclists on the path */}
      <g stroke="#262626" strokeWidth="2.5" fill="none" strokeLinecap="round">
        <circle cx="372" cy="600" r="9" />
        <circle cx="396" cy="600" r="9" />
        <path d="M372 600 L384 588 L396 600 M384 588 L388 576" />
        <circle cx="440" cy="590" r="9" />
        <circle cx="464" cy="590" r="9" />
        <path d="M440 590 L452 578 L464 590 M452 578 L456 566" />
      </g>
      <circle cx="389" cy="570" r="5" fill="#262626" />
      <circle cx="457" cy="560" r="5" fill="#262626" />

      {/* Foreground lawn and bluish path under the bench */}
      <path d="M0 622 C 400 604 900 612 1600 590 V640 H0Z" fill="#4F9E36" />
      <path d="M1040 640 C 1140 596 1320 586 1600 596 V640Z" fill="#9FC9E8" opacity="0.7" />

      {/* Bench */}
      <g transform="translate(1250 500) skewX(-8)">
        <rect x="0" y="0" width="170" height="10" rx="2" fill="#C8743A" />
        <rect x="0" y="15" width="170" height="10" rx="2" fill="#C8743A" />
        <rect x="0" y="30" width="170" height="10" rx="2" fill="#C8743A" />
        <rect x="-10" y="52" width="190" height="12" rx="2" fill="#B5652F" />
        <path d="M10 6 V96 M160 6 V96 M4 64 L-6 100 M166 64 L176 100" stroke="#262626" strokeWidth="6" strokeLinecap="round" />
        <path d="M-2 44 C 10 38 18 52 8 62 M172 44 C 160 38 152 52 162 62" stroke="#262626" strokeWidth="5" fill="none" />
      </g>
    </svg>
  );
}
