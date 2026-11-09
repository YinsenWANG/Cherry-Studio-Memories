# Cherry-Studio-Memories architecture

Status: narrow prototype based on Cherry Studio main `578dcc183632de98b9b4165155112c4f9298663c` and SiYuan 3.8.9. The user requested implementation and authorized a public fork; this document describes the implementation scope and its verification targets.

```text
Cherry agent A ─┐                         ┌─ SiYuan web editor (Cherry mini app)
Cherry agent B ─┼─ MCP Streamable HTTP ──► SiYuan kernel ──► one workspace
Other agents ───┘                         └─ Memories database, Guide, Skills
```

SiYuan is a separately installed process: it is not included in the Electron distribution. The MCP endpoint and web UI are the same kernel; the API token is supplied by the user to clients and never put into the setup prompt. Bootstrap uses the existing `@modelcontextprotocol/sdk` dependency and SiYuan's HTTP API. It creates a dedicated notebook, ordinary guide and skill-index documents, a native attribute-view database, and one example SiYuan SKILL.md without overwriting an existing skill. Reruns must preserve existing user documents and entries. Source agent and dates are explicit metadata, not reliable identity proofs. This first version is single-user: SiYuan's MCP runs with administrator rights to the entire connected workspace, not only this notebook.

Verification targets: build Cherry; start SiYuan in a temporary isolated workspace; bootstrap twice; exchange, edit and delete a memory through two independent MCP sessions; load the web editor; check the setup guide and the user-facing integration. Automated behavior is limited to explicit initialization: extraction, conflict decisions, skill selection and respecting exclusions require agent cooperation. No embeddings, synchronized replicas, background transcript harvesting, OAuth proxy, or new runtime dependencies are added.

The Cherry MCP entry is an inactive catalog preset: installing it, entering the token and attaching it to an agent remain manual. The browser entry is a seeded mini app, and the sidecar launcher and local UI run from a source checkout. No automatic agent binding is implemented.
