# Blog HTML Cleaner

Simple static web app for cleaning pasted blog HTML before pasting into Contentful.

## What it does

- Preserves links (`<a href="...">`)
- Removes images/media (`img`, `figure`, `svg`, `video`, etc.)
- Removes `div` and other wrapper tags that are usually unnecessary
- Removes lines that are exactly `Start Reading` or `Start Listening`
- Normalizes headings so only `h1`, `h2`, and `h3` remain (`h4+` become `h3`)
- Converts likely book-title paragraphs into `h3` headings
- Removes bold/italic/underline tags while keeping text
- Strips most attributes to reduce formatting noise

## Use

1. Open `index.html` in a browser (or host it).
2. Paste copied content into the top paste box.
3. Click **Clean HTML**.
4. Copy from **Clean HTML for Contentful** and paste into Contentful.

## Publish on GitHub Pages

1. Create a GitHub repo and push this folder.
2. In GitHub: `Settings -> Pages`.
3. Under `Build and deployment`, select `Deploy from a branch`.
4. Choose `main` and `/ (root)`.
5. Save. GitHub will provide the live URL.

## Notes

- Book-title detection uses heuristics (short title-like paragraph with strong/emphasis). Validate final output before publishing.
- If your source uses unusual markup, update rules in `app.js`.
