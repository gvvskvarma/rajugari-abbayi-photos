# Rajugari_Abbayi Photography

A React + TypeScript portfolio showcasing featured photography, rotating portrait galleries, and a booking enquiry form.

## Getting started

```bash
npm install
npm run dev
```

## Adding portrait photos (auto-rotating)

Drop images into these folders and they will auto-load and rotate every 2 seconds:

- `src/assets/potraits/baby/`
- `src/assets/potraits/potraits/`
- `src/assets/potraits/events/`

Supported formats: `jpg`, `jpeg`, `png`, `webp` (upper/lower case).

## Booking form (Formspree)

1. Create a form at Formspree and copy the form endpoint.
2. Add it to a `.env` file in the project root:

```bash
VITE_FORMSPREE_ENDPOINT=https://formspree.io/f/yourFormId
```

The booking page lives at `/book.html`.

## Tech stack

- React + TypeScript
- Vite
