# Visual design and assets

## Direction and readability

Use one visual thesis derived from the user's subject, audience, references and tone. Apply it through layout, type, spacing, surfaces, color and imagery, including mobile and interaction states. For existing sites, extend the established design unless a redesign is requested. A new direction should change more than accent colors.

Apply a new theme through shared tokens before styling individual components. In the React starter, use `src/globals.css`; keep its light and dark values consistent with the chosen direction. Existing projects retain their theme mechanism and supported modes. Treat the neutral starter theme as a starting point, not the finished design.

Give working surfaces useful controls and results in the first viewport. Use narrative composition when reading or persuasion is the task. Avoid filling every brief with the same oversized hero, feature cards and generic call to action. Keep content and capabilities within the request.

For new websites, prefer body text around 16px or larger and regular labels around 14px; reserve smaller type for secondary metadata. Evaluate the actual typeface, weight, line height, contrast and writing system together. Use relative sizing where practical and keep controls usable at increased text size. These are design defaults, not reasons to override a supplied design or the established project.

Account for mobile and desktop layout: readable text, usable controls, sensible density and no unintended clipping or horizontal overflow. Use accessible labels, keyboard behavior and meaningful focus states. Follow the [validation scope](../SKILL.md#validation-scope) for requested browser checks or diagnosis of an observed problem.

Use status dots and arrows only when they communicate state, direction or an action.

## Images

Select imagery for the site's purpose. A technical dashboard may need no discretionary images; a visually led portfolio, editorial or consumer site may benefit from one to three. This is not a limit on a requested gallery, catalog or supplied collection.

- Reuse suitable user-provided or existing assets first.
- Use image search for real or factually specific subjects; use available image generation for original artwork. Never fabricate a source URL or substitute generated art for requested factual evidence.
- Request standalone assets suited to their placement, not screenshots containing an entire interface or page text. Integrate only assets that support the experience.
- Use HTML/CSS/SVG for UI geometry, trusted icons, diagrams and data visualization. Use actual assets for representational artwork rather than assembling scenes from decorative elements.
- Start necessary image work as soon as the brief is clear; continue independent implementation while it runs. Avoid speculative variants and repeated generation. If delegating, use an asset-only brief; helpers return results without editing the site or calling Sites tools.

Reserve image dimensions while work continues. Before final validation, verify that selected assets load and satisfy their placement and reuse conditions. Remove unused optional placeholders; required imagery must be integrated, replaced with a suitable permitted fallback, or reported as incomplete. Pending required work is not a failed result. Keep private data and credentials out of asset requests and preserve required attribution.

## Metadata and social previews

Set the website's real title and description through HTML metadata or the framework's supported static-export API. Preserve existing metadata when it remains correct.

Give a new site a recognizable favicon: reuse a suitable supplied mark or create a small SVG in the site's colors that reads at 16 and 32 pixels. Reference it from the HTML head or framework metadata; a data URL works for a self-contained static page. Preserve an existing valid custom icon. This does not require image generation.

Create or refresh a social-preview image only when explicitly requested. Otherwise preserve an existing preview image and do not add generation work merely because one is missing. For a requested card, use the site's actual title/copy and visual direction, then verify the result matches the final page. Use an existing suitable asset if generation fails; omit missing image metadata rather than inventing a fallback URL.

For requested per-item previews, match each page's title, description and image to its record. Reuse the item's real image; do not generate a separate image for every record or give every item the same unrelated card. Absolute image URLs must use a verified site origin, not an invented deployment address or untrusted forwarded Host header.

Deployment thumbnails and social-preview images are different deliverables. Neither requires automatic screenshot capture or an extra release when the user did not request it.
