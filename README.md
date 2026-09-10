# Exercise slider instrument

Three sliders, three rounds, many participants, one live display. Built for tabletop
exercises where you want to record how a room's judgement moves as a scenario develops.

Participants open a link on their phones and mark where they stand. The facilitator opens
and closes each round. When a round closes, every slider locks and the last position each
person set is what is recorded. From round 2 onward each participant sees a grey tick
where they were previously, so the movement is deliberate rather than remembered.

No accounts, no names. Each device is identified by a random tag held in its own browser.

## Repository layout

All six files sit at the top level. There is no subfolder.

    .gitignore
    README.md
    index.html
    package.json
    render.yaml
    server.js

If `package.json` is not at the top level of the repo, Render's build fails with
`ENOENT: no such file or directory, open '/opt/render/project/src/package.json'`. That is
the only cause of that error.

## Push to GitHub

If the repo already exists and has the old files in it, the simplest route is GitHub's web
interface: open the repo, choose **Add file > Upload files**, drag in all six files, and
commit. Delete any leftover folder from the previous attempt afterwards.

From the command line, in an empty folder containing the six files:

    git init
    git add .
    git commit -m "Exercise slider instrument"
    git branch -M main
    git remote add origin https://github.com/mecedaa/UNGA_TTX_Slider.git
    git push -u origin main --force

Before pushing, run `ls` and confirm you see `package.json` and `server.js` in the folder
you are standing in, not inside a subfolder.

## Deploy on Render

1. **New > Web Service**, connect the repo.
2. Runtime: Node. Build command: `npm install`. Start command: `node server.js`.
   Health check path: `/healthz`.
3. Leave **Root Directory** blank.
4. Add an environment variable `FACILITATOR_CODE` with whatever code you want. Without it
   the code is `chair`. It is checked on the server, so it never appears in the page
   source that participants can read.
5. Deploy. Open the URL Render gives you and make a QR code from it for the room.

`render.yaml` is included if you prefer **New > Blueprint**, which sets all of the above.

## Where the data lives

Results are held in a JSON file at `DATA_DIR` (default `./data`). Three options:

**Free instance, no disk.** Costs nothing. The service sleeps after about 15 minutes of no
traffic, so the first person to open the link after a quiet period waits roughly a minute
for it to wake, and the filesystem is wiped on any restart or redeploy. During a live
exercise the constant traffic keeps it awake and the data is safe, but a redeploy
mid-session would clear it.

**Paid instance with a persistent disk.** Add a disk in Render, mount it at `/var/data`,
and set `DATA_DIR=/var/data`. Results survive restarts and redeploys. This is what
`render.yaml` is configured for.

**Postgres.** Set `DATABASE_URL` and the server uses Postgres instead of the file, with no
other changes.

Whichever you choose, download the CSV at the end of the session. That is your record.

## Running a session

- Open the link yourself, scroll to the bottom, click **Facilitator controls**, enter the
  code. Your browser remembers it after that.
- Pick the round, click **Open this round**. Participants can move within about a second.
- The three charts update live as people move: one dot per participant per round, with the
  mean marked. Put this on the projector during the debrief.
- Click **Close round and save positions** when the round ends, then move to round 2.
- **Download CSV** gives you one row per participant per round.

## Changing the questions

Wording, endpoint labels, round labels and the title are editable in the facilitator panel
and apply to everyone immediately. The scales are set at the top of the script in
`index.html`:

    var SCALES = [
      { min:0, max:10, step:1,   showValue:true  },   // How concerned are you?
      { min:0, max:10, step:0.1, showValue:false },   // Should this be termed a crisis?
      { min:0, max:10, step:1,   showValue:true  }    // How well do you understand the cause?
    ];

`showValue:false` hides the number from participants, which is what makes the second
slider read as a No-to-Yes continuum rather than a score. Changing a scale after people
have answered will misplace the existing dots, so clear the responses if you do it.

The instrument is fixed at three questions and three rounds. Changing that means editing
the array handling in both `server.js` and `index.html`.

## Local check before the day

    npm install
    node server.js
    # http://localhost:3000

Open it in two browsers, open a round in one, confirm the other unlocks, close it,
confirm it locks.

## Notes

- Live updates use server-sent events, with a 15-second poll as a fallback if a network
  blocks the stream.
- Only `index.html` is served. `server.js` and `package.json` are not reachable over HTTP.
- A participant who switches device mid-exercise arrives as a new participant with no
  earlier rounds. Tell people to stay on one device.
- The page sets `noindex`, but the URL is otherwise unguarded beyond being unguessable.
  Anyone with the link can submit slider positions.
