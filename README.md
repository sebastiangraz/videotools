Web application with video tools: seamless loops, image sequences to video, speed changes, format conversion and watermarking. See [robots.md](robots.md) for how it works.

Requires Node 24. Setup:

```bash
npm install                  # deps + pinned ffmpeg/gifski (postinstall)
npm i -g vercel              # Vercel CLI
vercel link                  # link to the Vercel project (with a Blob store connected)
vercel env pull .env.local   # BLOB_READ_WRITE_TOKEN

npm run dev                  # run locally (vercel dev)
npm test                     # unit tests
npm run lint                 # eslint
npm run typecheck            # tsc
npm run smoke -- <label>     # end-to-end run against the real ffmpeg
```
