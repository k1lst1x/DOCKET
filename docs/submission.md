# DOCKET — submission draft

> Replace the bracketed links before publishing this text on Devpost.

## Inspiration

City decisions are public, but following them is still a part-time job. Fremont
residents must search agendas, meeting minutes, staff reports, and city news to
learn whether a decision affects their neighborhood. By the time an important
update is understood, the opportunity to respond is often gone.

## What it does

DOCKET is a civic reading agent for Fremont neighborhoods. It monitors public
city records, turns long documents into source-linked updates, and gives
residents a place to explore what changed, why it matters locally, and how
neighbors feel about it.

Residents can select a neighborhood, discover nearby civic places, browse
issues and updates, read evidence-backed summaries and pros/cons, add reviews,
vote in community polls, and ask a question in plain language. Community votes
show resident opinion; they are never presented as official legislative votes.

## How we built it

The Python backend uses **Strands Agents** for retrieval-grounded chat and
generation. Its AgentCore pipeline fetches public civic sources through
Firecrawl or HTTP, respects robots.txt, extracts and chunks documents, creates
embeddings, and stores evidence in Aurora DSQL, Amazon S3, and Amazon S3
Vectors. The generation flow checks claims against retrieved evidence before it
stores a source-linked summary, announcement, or pros/cons output.

The project deploys two Amazon Bedrock AgentCore runtimes:

- `docket_pipeline` performs ingestion and verified generation in the
  background.
- `docket_chat` answers resident questions with citations from the indexed
  civic corpus.

The Next.js web app provides the resident experience, email and password accounts,
neighborhood membership, reviews, and community voting. Its server route calls
the AgentCore chat runtime, so AWS credentials never reach the browser.

## Why it matters

DOCKET turns a fragmented civic-information process into a quiet background
service. Instead of asking residents to repeatedly search city sites and read
hundreds of pages, the agent does the repetitive work and surfaces a clear,
verifiable update when a person needs context or wants to participate. The
result is a more informed and connected neighborhood without pretending that
AI-generated text is a substitute for the original public record.

## Links

- Source code: https://github.com/k1lst1x/DOCKET
- Live demo: https://main.d2iineib6nghao.amplifyapp.com
- Demo video: [YouTube or Vimeo URL]
- Architecture diagram: [`docs/architecture.png`](architecture.png) ([SVG](architecture.svg))

## Track

**Good Neighbor Agents**
