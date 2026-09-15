# Third-party and pre-existing work disclosure

DOCKET was created for the Agents for Humans Hackathon. The project uses the
following third-party software, cloud services, and public data sources. Their
licenses and terms continue to apply.

| Item | Role in DOCKET |
| --- | --- |
| Next.js, React, TypeScript, Tailwind CSS | Web application framework and presentation layer |
| FastAPI, Uvicorn, uv | Python API and development tooling |
| Strands Agents SDK | Agent orchestration and tool-use framework |
| Amazon Bedrock AgentCore, Aurora DSQL, S3, S3 Vectors, Amplify | Deployment, persistence, retrieval, and hosting services |
| Firecrawl | Retrieval of public civic web pages where configured |
| Google Maps Platform | Neighborhood place discovery and map display where configured |
| Public Fremont and California civic websites | Source material for the agent's evidence corpus |

No third-party source text is represented as original DOCKET content. The agent
stores citations and links to source documents so users can inspect the public
record. API keys and AWS credentials are supplied by deployment environment
variables or AWS Secrets Manager and are not committed to this repository.

The repository is released under the [MIT License](../LICENSE). Dependency
licenses remain the responsibility of their respective authors and publishers.
