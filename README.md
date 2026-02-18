# Blog HTML Cleaner

Simple static web app for cleaning pasted blog HTML before pasting into Contentful.

## What it does

- Preserves links (`<a href="...">`)
- Removes images/media (`img`, `figure`, `svg`, `video`, etc.)
- Removes `div` and other wrapper tags that are usually unnecessary
- Removes lines that are exactly `Start Reading` or `Start Listening`
- Removes linked `Start Reading` / `Start Listening` text
- Normalizes headings so only `h1`, `h2`, and `h3` remain (`h4+` become `h3`)
- Converts list items into `h3` book headings and italicizes book titles
- Converts likely book-title paragraphs into `h3` headings and italicizes titles
- Removes bold/underline tags while keeping text
- Strips most attributes to reduce formatting noise
- Includes a **Validate Links** action (best effort) to remove links that resolve to a known dead-page message

## Use

1. Open `index.html` in a browser (or host it).
2. Paste copied content into the top paste box.
3. Click **Clean HTML**.
4. Optional: click **Validate Links** to test links and unlink dead-page destinations.
5. Copy from **Clean HTML for Contentful** and paste into Contentful.

## Publish on GitHub Pages

1. Create a GitHub repo and push this folder.
2. In GitHub: `Settings -> Pages`.
3. Under `Build and deployment`, select `Deploy from a branch`.
4. Choose `main` and `/ (root)`.
5. Save. GitHub will provide the live URL.

## Notes

- Link checking is best effort in the browser. Some sites block cross-origin fetches (CORS), so a manual spot check is still recommended.
- Book-title detection uses heuristics. Validate final output before publishing.
- If your source uses unusual markup, update rules in `app.js`.
