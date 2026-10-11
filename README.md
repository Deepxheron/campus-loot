# Campus Loot

A just-for-fun campus treasure hunt site.

- Students see **ongoing, upcoming and past** hunts (cash, vouchers, mystery box).
- A student pays you by UPI, you send a **ticket code**, and only then can they watch the **clue video**.
- The code is checked on the **server**, and the video file is never public. Without a valid ticket the server refuses to send it.
- You manage everything from `/admin`: create events, upload the video, make ticket codes.

## Run it in VS Code

1. Install **Node.js 18 or newer** from https://nodejs.org (LTS).
2. Open this folder in VS Code (File > Open Folder).
3. Open the terminal (Terminal > New Terminal) and run:

   ```
   npm install
   ```
4. Copy `.env.example` to a new file named `.env` and fill it in. At minimum set `ADMIN_PASSWORD` and `UPI_ID`.
5. Start it:

   ```
   npm start
   ```
6. Open http://localhost:3000 for the site and http://localhost:3000/admin for the organiser page.

The first run adds two sample events. Delete them from the admin page before going public.

### Your first hunt

1. Go to `/admin` and log in.
2. **New event**: title, prize, ticket price, start and end time.
3. **Upload video**: the clue video that shows where the treasure is hidden.
4. When someone pays you, open **Tickets** on that event, create a code and send it to them.
5. They tap **Get ticket** on the event card, enter the code, and the video unlocks.

Each code works on up to 2 devices (change with `MAX_DEVICES`), and the video stops playing once the hunt ends.

## Make it a public website

Your laptop is only reachable by you. Pick one:

**A. Free and quick, for a weekend event: tunnel from your laptop.** The site is public while your laptop and the server are running.
Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and run, in a second terminal:

```
cloudflared tunnel --url http://localhost:3000
```

It prints a `https://something.trycloudflare.com` link. Share that link.

**B. A real host that stays online.** Push this folder to a GitHub repository, then create a **Web Service** on [Render](https://render.com) or [Railway](https://railway.app):

- Build command: `npm install`
- Start command: `npm start`
- Environment variables: `ADMIN_PASSWORD`, `UPI_ID`, `CONTACT`
- Add a **persistent disk or volume**, mount it at e.g. `/data`, and set `DATA_DIR=/data`.

Without a persistent disk, free hosting wipes events, tickets and videos every time the server restarts.

## Before you go live

- Use a long `ADMIN_PASSWORD`. Never commit `.env` (it is already in `.gitignore`).
- Payments are manual. You check the UPI payment yourself, then send the code. There is no automatic payment check.
- Nothing can stop a student from screen-recording the video. The tickets only stop people who have not paid from getting it. Keep the video short and the hunt window short.
- Charging a fee for a game with cash prizes can fall under prize-competition or gambling rules in some states, and universities often need to approve events. Check with your college and a local adviser before charging money.

## Project layout

```
server.js        the server: API, ticket checks, video streaming, admin
public/          index.html (site), admin.html, app.js, admin.js, style.css
data/            created on first run: db.json and private videos (git-ignored)
```
