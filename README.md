# 🐐 Goat Crew — DM screen

A static web app for the two DMs of The Goat Crew. One shared screen: maps with pins and a
party marker, floor plans with notes, the party, the battle tracker with an SRD bestiary, journal,
codex, quests, the Arc board, and a DM-to-DM chat with a Claude assistant that has read the whole
campaign.

- **Hosting:** GitHub Pages (this folder is the whole site, no build step).
- **Database:** JSON files on the `data` branch of the **private** repo `ninjaMonkey7/goat-crew-campaign-app`.
  Every save is a commit, made with the logged-in DM's GitHub token. Both DMs poll it every 4 s.
- **Login:** a GitHub fine-grained token (stored only in your browser) + which DM you are. No passcodes.
- **Assistant:** your own Anthropic API key, stored only in your browser, calls Anthropic directly.

## Tonight: get it running (about 10 minutes)

### 1. Create the public repo for the site
GitHub Pages on a free plan needs a **public** repo, so the site code lives apart from the campaign data.
Nothing in this folder is campaign content: maps, notes and portraits stay in the private repo.

1. github.com → **New repository** → name `goat-crew-dm` → **Public** → no README → Create.
2. Put this `site/` folder in it. Easiest: tell Claude the repo exists and it will push it. By hand, from a
   clone of the private repo:

```bash
cd goat-crew-campaign-app/site
git init -b main && git add -A && git commit -m "Goat Crew DM screen"
git remote add origin https://github.com/ninjaMonkey7/goat-crew-dm.git
git push -u origin main
```

3. In `goat-crew-dm` → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.
   After a minute the site is at **https://ninjamonkey7.github.io/goat-crew-dm/**

### 2. Make your GitHub token (each DM makes their own)
1. github.com → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name: `Goat Crew DM screen`. Expiration: 90 days or more.
3. **Repository access:** *Only select repositories* → `goat-crew-campaign-app`.
4. **Permissions → Repository permissions → Contents: Read and write.** Nothing else.
5. Generate, copy the `github_pat_…` string. Paste it on the site's login screen, pick your name, Enter.

### 3. Let your co-DM in
1. Private repo `goat-crew-campaign-app` → **Settings → Collaborators → Add people** → their GitHub username.
2. They accept the invite, make their own token (step 2), open the site and pick **Co-DM**.

### 4. Turn on the assistant
1. console.anthropic.com → **API keys → Create key**. Copy it.
2. On the site: **⚙ Settings → Assistant → API key → Save.** Each DM pastes a key into their own browser
   (one shared key is fine too).

## At the table

| Tab | What it is for |
|---|---|
| 🗺 **Map** | Region map with pins (tap a pin: label, icon, Codex link). **🐐 Party here** drops the party marker; drag it as they travel. Floor plans for **White Cross Hospital** and **the tunnels**: tap a room for the read-aloud text, DM notes, *explored*, and **Party moves here**. Both DMs see all of it. |
| 💬 **DM Chat** | Messages between the two of you. **Catch me up / Options from here / Remind me about… / Encounter idea / NPC on the spot / Recap** ask the assistant; its answer lands in the thread for both DMs. `Enter` sends, `Ctrl/⌘+Enter` asks. |
| **Party** | Character cards. Tap one for HP/AC/gold editing, conditions, DM notes, the full sheet. |
| **Battle** | Run the fight: −/+ HP, ▶ Next turn, 📖 stat block. Build the encounter on the **DM** tab: **+ Monster** picks from ~50 SRD monsters, rolls initiative and fills AC/HP/attacks; **+ Add whole party** adds the PCs. |
| **Journal / Codex / Quests / Board / Arc / My Notes / DM** | As before. The Arc board shows the current arc (*White Cross Hospital*), with the Saltwick arc kept. |
| ⚙ **Settings** | Tokens, data repo, assistant model and effort, "forget everything on this device". |

The green ● in the header means the screen is polling the data branch. Red: check the network or the token.

## How it works

- `gh.js` is the data layer. It reads `data/*.json` from the data branch through the GitHub REST API,
  polls the branch head (cheap conditional requests) and writes each change back as a commit with the
  file's blob SHA, so two DMs saving the same file at once can't clobber each other (the second save
  re-reads and re-applies).
- `media/` (maps, portraits) is fetched with the token and shown from memory, so images never leave the
  private repo.
- `app.js` is the original campaign-app UI; `map.js`, `chat.js`, `bestiary.js`, `dm.css` are the DM-screen additions.
- `tools/migrate-data.mjs` (in the private repo) is the one-off script that built the data branch from `data.json`.

## Backups and undo
The data branch *is* the backup: every save is a commit. `git log data` shows who changed what and
when; `git revert` or editing a JSON file on that branch undoes it. To take a copy:

```bash
git clone --branch data https://github.com/ninjaMonkey7/goat-crew-campaign-app goat-crew-data
```

## Run it locally
```bash
python3 -m http.server 8080 --directory site
```
Open http://localhost:8080 and log in as usual (the data still comes from GitHub).

## Troubleshooting
- **"Not found on GitHub: data/users.json"** — the token can't see the private repo (wrong repository
  selected when creating it, or the co-DM hasn't accepted the invite), or the repo/branch under
  *Data repo settings* is wrong.
- **403** — token permissions (needs *Contents: Read and write*) or the API rate limit (5,000 requests/hour per token; polling uses almost none).
- **Assistant: "API key rejected"** — re-paste the key under ⚙ Settings.
- **Something saved wrong** — fix it on the data branch on GitHub (edit the JSON file in the browser) or revert the commit.

## Credits
Monster stat blocks are summarised from the *Systems Reference Document 5.1* by Wizards of the Coast,
licensed under the Creative Commons Attribution 4.0 International License. Maps and characters are the
Goat Crew's own. Leaflet (BSD-2) is vendored under `vendor/leaflet`.
