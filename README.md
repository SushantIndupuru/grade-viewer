# Grade Viewer

A StudentVUE grade viewer. Sign in with your own district credentials to browse courses, assignment impact, and local what-if grades.

Live site: [gradeviewer.org](https://gradeviewer.org)

This project is not affiliated with Edupoint, StudentVUE, Synergy, or any school district. Use it only with your own account, and follow your district’s acceptable-use rules.

## What it does

- Relays your StudentVUE login and gradebook request through the app server (the browser cannot call StudentVUE directly)
- Shows courses, weighted categories, assignment impact, documents, mail, and attendance
- Lets you try what-if scores **in this browser only** — they are never written back to the district

## Privacy

Grade Viewer does not create accounts or store passwords, grades, or a student database. After sign-in, this browser keeps an encrypted copy of your login on the device. Signing out deletes it. What-if edits live in `sessionStorage` on your device.

See the in-app [privacy note](src/pages/privacy.astro) for the wording shown to users.

Feedback and problems: [contact@gradeviewer.org](mailto:contact@gradeviewer.org).

If you self-host, you are responsible for your own hosting logs and privacy policy.

## Setup

Need Node.js 22.12 or newer.

```bash
git clone https://github.com/SushantIndupuru/grade-viewer.git
cd grade-viewer
npm install
cp .env.example .env.local
```

Optionally set `PUBLIC_DEFAULT_DISTRICT_URL` in `.env.local` to pre-fill the sign-in form for your district.

```bash
npm run dev
```

The app is at [http://localhost:4321](http://localhost:4321).

| Command | Action |
| --- | --- |
| `npm run dev` | Start the local server |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build |

## Deploy

The repo is set up for [Vercel](https://vercel.com) with the Astro server adapter. Optionally set `PUBLIC_DEFAULT_DISTRICT_URL` to your district’s StudentVUE portal, for example `https://your-district.edupoint.com`.

To self-host with Node instead of Vercel, switch the adapter in `astro.config.mjs` (`npx astro add node`) and run the Node server Astro generates.

## License

GNU General Public License v3.0 or later. See [LICENSE](LICENSE).
