# Concert photo captions

Instagram captions for live music photography, written for **Movin 92.5** (Seattle, Top
40) and credited to **@dcongerphoto**. The idea in one line: weave the artist's own song
titles into the sentence so they read as natural wordplay rather than as a list of
references.

The operating instructions live in
[`.github/skills/concert-photo-captions/SKILL.md`](../.github/skills/concert-photo-captions/SKILL.md).
This file is the record of how those rules were arrived at.

## Results so far

| Date | Show | Status |
|---|---|---|
| 2026-08-26 | Becky G, Lumen Field (opener) | Published |
| 2026-08-26 | Karol G, Lumen Field | Published |
| 2026-08-30 | Noah Kahan, T-Mobile Park | Published — **biggest response of any post** |
| 2026-09-01 | Tame Impala, Climate Pledge Arena | Options written, pick not yet recorded |

The one to copy:

> @noahkahanmusic turned @tmobilepark into a Vermont field for one night, Northern
> Attitude and all. 💚 🌲 Seattle sang Stick Season back like We'll All Be Here Forever.
> #TheGreatDivideTour (📸 @dcongerphoto)

Everything the process learned is visible in that sentence: handles as grammar rather
than tags, three Title Case song titles carrying real meaning, paired emoji doing two
different jobs at the pivot, the tour hashtag, and the credit last.

## How the process changed

**It started as a list and became an argument.** The first pass was a long menu of
options in tables. What the format actually needed to be was flowing prose that explains
*why* each caption works and what every title means. The explanations are not decoration
— they are the correctness check, and they are the part of these files that gets used
most.

**Every option became publish-ready.** Early drafts put handles and the photo credit only
on the recommended caption. That forces hand-editing on any other choice, so now every
option is complete as written.

**Structure settled on two sentences.** One carries the local or venue angle, the other
carries crowd or performance energy, with two or three titles total. Longer than that and
the wordplay stops landing.

## What actually makes a caption land

**Ask what the night looked like before writing anything.** The single best line of the
project came from an offhand mention that the crowd was dressed in orange and pink, which
matched Karol G's *Verano Rosa* ("Pink Summer"). Crowd colours, weather, lighting,
confetti — that is where the material is. No amount of discography reading substitutes
for it.

**Stay true to the actual night.** Seattle rain is the obvious reach and the obvious trap.
If it did not rain, a rain pun is simply wrong, and it gets noticed. Confirm conditions
before leaning on any local cliché.

**Legibility beats cleverness.** "Two green states, one northern attitude" fails, because
it never names either state and the reader has to do the work. "Green Mountain State to
Evergreen State" works, because it reasons for you. If a caption needs a footnote, it has
failed.

**Specific geography outperforms hype.** Noah Kahan is from a Vermont town of under two
thousand people; Vermont is the Green Mountain State and Washington is the Evergreen
State; *Northern Attitude* is about a cold northern upbringing and Seattle is the
northernmost major city in the lower forty-eight. That parallel is defensible and
particular. Generic stadium-energy copy is neither.

**One anchor hit is enough.** Only one title needs to be radio-familiar. Once that anchor
is there, the rest can be deeper cuts if the wordplay is better. Forcing three hits into
a sentence loses the idea.

**Titles that are already English are free wins.** *Shower*, *Can't Get Enough*,
*Unstoppable*, *Ocean* need no translation and read cleanly to a general audience.

**The tour hashtag is a live discovery channel.** People browse it actively while a tour
is running. The best-performing post was the first one to use it.

## Mistakes worth remembering

**Never negate a song title.** A draft read "no rain, no Stick Season." In a concert
caption that parses first as *he didn't play Stick Season* — the opposite of the intent,
about the artist's biggest song, and easy to publish without noticing. Replaced with *No
Complaints*, a real track that is also a natural English phrase. Keep titles in positive
constructions, and use *Stick Season* later in the plain way instead.

**Check the billing before writing.** Becky G opened and Karol G headlined the same night.
Nothing may imply the opener filled the stadium, and nothing may imply a joint set when
they performed separately.

**Keep collaborations with the right artist.** *Mamiii* belongs in Becky G's post, not
Karol G's, because Karol G is the guest on it.

**Screen for innuendo.** A radio station feed is brand-safe. *Sin Pijama* and *Punto G*
are both real hits and both unusable.

**Verify handles separately.** Wikipedia does not carry social handles. A wrong tag is the
one mistake that cannot be quietly fixed after posting.

**The chart that matters depends on the station.** Movin 92.5 is Top 40, so weight by the
Hot 100. A song that was enormous on a genre chart can mean nothing to that audience, and
the reverse is equally true.

## Research

Go straight to `https://en.wikipedia.org/wiki/<Artist>_discography` and the album pages.
Web search proved slow and unreliable for this; Wikipedia fetches are fast and
authoritative. Verify that every title exists and is actually by that artist — guest
features are a common trap. Album titles are often better material than song titles,
because they tend to be complete thoughts.

## Conventions

Files are named `YYYY-MM-DD-artist-venue.md`. Each opens with a starred recommendation,
walks through alternatives as prose, and closes with notes on what to avoid. Once a
caption is posted, a `## ✅ Published` block records what actually went out.

**Edit these files in place across turns.** Recreating them silently drops explanations
and options that were worth keeping.

The skill is the canonical copy. After changing it, sync it so it is picked up:

```powershell
Copy-Item .github\skills\concert-photo-captions\SKILL.md `
  $HOME\.copilot\skills\concert-photo-captions\SKILL.md -Force
```
