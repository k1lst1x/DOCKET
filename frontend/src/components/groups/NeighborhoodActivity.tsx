import { formatDate, formatNumber, plural } from "@/lib/format";
import type { CityProject, NeighborhoodActivity, ProjectKind, ResidentReport, SafetyAlert } from "@/lib/neighborhood-activity";

// Group-page sections built from the reading agent's records for one neighborhood: what residents filed on
// the Fremont App, the city's projects and development sites there, and the latest police and city alerts.

const REPORT_A_PROBLEM = "https://fremontca.citysourced.com/servicerequests/create";

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

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

export function NeighborhoodActivitySections({ name, activity, now }: { name: string; activity: NeighborhoodActivity; now: number }) {
  return (
    <>
      <ReportsSection name={name} activity={activity} now={now} />
      <ProjectsSection name={name} activity={activity} />
      {activity.alerts.length ? <AlertsSection alerts={activity.alerts} now={now} /> : null}
    </>
  );
}

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

function ReportsSection({ name, activity, now }: { name: string; activity: NeighborhoodActivity; now: number }) {
  const { reports, reportsLast30Days, reportsTotal, openReports } = activity;
  return (
    <section aria-labelledby="neighborhood-reports" className="border-t border-rule bg-sky-mist">
      <div className="page py-14 sm:py-20">
        <SectionHeading id="neighborhood-reports" eyebrow="Reported to the city" title="What neighbors are reporting">
          <a href={REPORT_A_PROBLEM} {...external} className="btn btn-secondary h-11 rounded-full px-5">
            Report a problem
            <span className="sr-only"> on the Fremont App (opens in a new tab)</span>
          </a>
        </SectionHeading>
        <p className="mt-3 max-w-read text-base text-ink-soft">
          {reportsTotal ? (
            <>
              {plural(reportsLast30Days, "request")} filed from {name} on the Fremont App in the last 30 days. {formatNumber(reportsTotal)} on file in all
              {openReports ? `, ${formatNumber(openReports)} still open` : ""}.
            </>
          ) : (
            <>No Fremont App requests from {name} on file yet. Potholes, graffiti, broken streetlights and dumping reported here show up the next morning.</>
          )}
        </p>
        {reports.length ? (
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {reports.map((report) => (
              <ReportCard key={report.id} report={report} now={now} />
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function ReportCard({ report, now }: { report: ResidentReport; now: number }) {
  return (
    <li className="flex flex-col rounded-2xl border border-rule bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${report.open ? "bg-ochre-wash text-ochre" : "bg-park-wash text-park"}`}>
          {report.open ? "Open" : "Closed"}
        </span>
        {report.reportedAt ? (
          <time dateTime={report.reportedAt} className="text-sm text-ink-muted">
            Filed {filedLabel(report.reportedAt, now)}
          </time>
        ) : null}
      </div>
      <h3 className="mt-2 text-lg font-semibold leading-snug text-ink">{report.category}</h3>
      {report.address ? <p className="mt-1 text-base text-ink-soft">{report.address.replace(/,\s*Fremont,?\s*CA\b\s*/i, ", ").replace(/,\s*$/, "")}</p> : null}
      {report.description ? <p className="mt-2 text-base leading-relaxed text-ink">“{report.description}”</p> : null}
      <div className="mt-auto pt-3">
        {report.status ? <p className="text-sm text-ink-muted">Status: {report.status}</p> : null}
        <a href={report.url} {...external} className="link mt-1 inline-block text-sm">
          {report.caseNumber ?? "Request"} on the Fremont App
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </li>
  );
}

function ProjectsSection({ name, activity }: { name: string; activity: NeighborhoodActivity }) {
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
              <ProjectCard key={project.id} project={project} />
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
                <ProjectCard key={project.id} project={project} />
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

function ProjectCard({ project }: { project: CityProject }) {
  return (
    <li className="flex flex-col rounded-2xl border border-rule bg-sky-mist/40 p-5">
      <p className="eyebrow">{KIND_LABEL[project.kind]}</p>
      <h4 className="mt-1 text-lg font-semibold leading-snug text-ink">{project.title}</h4>
      {project.location ? <p className="mt-1 text-base text-ink-soft">{project.location}</p> : null}
      {project.description ? <p className="mt-2 text-base leading-relaxed text-ink">{project.description}</p> : null}
      <div className="mt-auto pt-3">
        {/* Development sites carry the city's short status code (APV, BPR, OPC, PRP, UC); the layer doesn't define
            them, so they're shown as recorded rather than guessed. The project layers only have free-text notes. */}
        {project.status ? (
          <p className="text-sm text-ink-muted">
            {project.kind === "development" ? "City status code" : "Notes"}: {project.status}
          </p>
        ) : null}
        {project.facts.length ? <p className="text-sm text-ink-muted">{project.facts.join(" · ")}</p> : null}
        {project.url ? (
          <a href={project.url} {...external} className="link mt-1 inline-block text-sm">
            Project page
            <span className="sr-only"> for {project.title} (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}

function AlertsSection({ alerts, now }: { alerts: SafetyAlert[]; now: number }) {
  return (
    <section aria-labelledby="neighborhood-alerts" className="border-t border-rule bg-sky-mist">
      <div className="page py-14 sm:py-20">
        <SectionHeading id="neighborhood-alerts" eyebrow="For all of Fremont" title="Police and city alerts" />
        <ul className="mt-8 divide-y divide-rule rounded-2xl border border-rule bg-white">
          {alerts.map((alert) => (
            <li key={alert.id} className="p-5 sm:p-6">
              <p className="text-sm text-ink-muted">
                {[alert.agency, alert.postedAt ? whenLabel(alert.postedAt, now) : null].filter(Boolean).join(" · ")}
              </p>
              <h3 className="mt-1 text-lg font-semibold leading-snug">
                <a href={alert.url} {...external} className="text-ink hover:underline hover:underline-offset-4">
                  {alert.title}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </h3>
              {alert.excerpt ? <p className="mt-1 text-base text-ink-soft">{alert.excerpt}</p> : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
