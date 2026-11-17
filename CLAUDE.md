# Bogabee Apiaries site

The site at bogabeeapiaries.com. `npm run build` renders `src/` and `content/` with `public/` into `dist/`. See `README.md`.

## Where it deploys

- **Staging**, https://bogabee-site.pages.dev: the git-connected Pages project `bogabee-site` builds every push to `main`.
- **Production**, https://bogabeeapiaries.com and www: the Direct Upload Pages project `bogabee-apiaries`. Only a release deploys it. Merging never does.

## Client notes and releases

`PATCH_NOTES.md` is what the client reads. Each entry goes out by email, and to the public history page if the client agreed to one. The kit lives in `ayr/`, and its settings for this client are in `ayr/client.json`.

`ayr/package.json` pins exact versions, and the workflows install from it with no lockfile. `ayr/.gitignore` keeps `ayr/package-lock.json` and `ayr/node_modules/` out of the repo.

### Merging and releasing are separate

- Merging a pull request stops at staging. That's where `pr-review-merge` stops for this repo. It never deploys production and never emails the client.
- A release is the `client-release` skill, in this order:
  1. `node ayr/bin/ayr.ts release draft` writes the notes into one commit on main, and makes the pictures, the recording and a review page. Its JSON line carries that draft's `commit`. Pictures and recordings go in the email only: never on the site or in the repo.
  2. The owner reads the review page.
  3. The owner presses Release on the page, or says "send it" in the thread.
  4. A press runs the release by itself. For "send it", and only then, run `node ayr/bin/ayr.ts release run --commit <sha>`, with the `commit` from the draft the owner read. It deploys, checks the live site, tags, and publishes the GitHub Release, which emails the client.
- Never run `ayr release run` before the owner says to send that draft, and never press the page's buttons or call its `api/release` address yourself. Nothing in the command or the page checks that the owner read it, so this rule is the only check.
- Pass `--commit` from the draft the owner approved, never from a later one. If `run` says the review is of another commit, another thread drafted since. Show the owner the new page and ask again.
- `node ayr/bin/ayr.ts release status` says what is waiting on main. It only reads, so run it whenever you're unsure.
- If a release stopped after its tag, `release status` prints the `release run --commit <sha>` that finishes its email. That run needs no review page and deploys nothing.
- `node ayr/bin/ayr.ts release undo` takes back a draft that wasn't released, so its notes can be edited.
- Never run a deploy to production by hand, and never email the client yourself.

### In a pull request

- Never edit `PATCH_NOTES.md` or the history page. The release writes them, and CI refuses the edit.
- A change file in `changes/` is optional. If you add one, it ships with the next release. `node ayr/bin/ayr.ts change <id>` starts it.
- If this changes how staff work, the heads-up goes out first, using the `heads-up` template. Don't merge until the date in it.

### Change files

The release turns each change file into one bullet of the client's note. The `client-release` skill writes them. Here's what one looks like:

```md
---
action: none
picture: compare phone /start #book
alt: The booking form on a phone, before and after this update
record: phone /start
step: tap "Book a call"
step: see "Pick a time"
---
**New — customers can book a call from their phone.** They pick a time
and get a confirmation on the spot. → [Get Started](https://example.com/start#book)
```

`action:` is `none` or `You need to: <what>.` `picture:` is `after` or `compare`, `phone` or `desktop`, a path and an optional section, or `none`. `record:` and its `step:` lines are optional, and the last step is a `see`. An `*Under the hood:*` change has only the bullet.

### Writing the bullet

- Write for the business owner and their staff, reading on a phone. Read each sentence as they would. If it needs a developer to explain it, rewrite it or cut it.
- If you don't know whether the client needs to do something, ask before writing the rest.
- Say what someone sees or can now do, not what changed in the code.
- Link the most specific place that exists. A section beats the bare page.
- Add a picture when it shows the change faster than words.
- Keep fixes short and plain. A serious fault gets its own message, not a line here.
- Behind-the-scenes work is an `*Under the hood:*` change only if the owner would care. If it can't be said plainly in one sentence, make it quiet.
- Only write what happened. If you didn't check it, don't say it was checked.
- Leave out staff and customer names, and anything that sells. This text can be public.
- Keep a security fix vague until it's live. Say what the fix protects, never how the weakness worked.

Bad: "Refactored header CSS to prevent nav wrapping at 1280px."

Good: "**Fixed — navigation labels stay on one line.** The menu no longer crowds or wraps on mid-size screens. → [Homepage](https://example.com/)"
