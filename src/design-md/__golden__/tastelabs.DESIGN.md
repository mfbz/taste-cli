---
version: alpha
name: "Taste"
description: "Dark, monochromatic design with stark contrast between deep blacks (#1e1e1e, #111) and off-white/cream (#f5f7f2) sections. Bold, modern typography combining Matter sans-serif with Azeret Mono for technical credibility. Animated 3D card carousels, Lottie animations, and interactive elements create a sophisticated, research-lab aesthetic."
colors:
  ink-black: "#333333"
  system-blue: "#0000EE"
  paper-white: "#F5F7F2"
  void-black: "#111111"
  slate-gray: "#8B8B8B"
typography:
  hero-headline:
    fontFamily: "Matter TRIAL"
    fontWeight: 700
    lineHeight: 1.02
  global-headline-l:
    fontFamily: "Azeret Semimono"
    fontWeight: 400
    lineHeight: 1.2em
  global-headline-m:
    fontFamily: "Matter"
    fontWeight: 400
    lineHeight: 1.2em
  global-headline-s:
    fontFamily: "Matter"
    fontWeight: 400
    lineHeight: 1.25em
  global-headline-xs:
    fontFamily: "Matter"
    fontWeight: 400
    lineHeight: 1.25em
  body-text:
    fontFamily: "Matter"
    fontWeight: 300
    lineHeight: 1.5em
  body-small:
    fontFamily: "Matter"
    fontWeight: 300
    lineHeight: 1.3em
  body-text-azeret:
    fontFamily: "Azeret Semimono"
    fontWeight: 400
    lineHeight: 1.5em
  blog-paragraph:
    fontFamily: "Matter"
    fontSize: 17px
    fontWeight: 300
    lineHeight: 1.5em
  button-text:
    fontFamily: "Azeret Semimono"
    fontWeight: 400
    lineHeight: 1.4em
  nav-link-text:
    fontFamily: "Matter"
    fontWeight: 400
    lineHeight: 1.4em
  tag-badge:
    fontFamily: "Azeret Semimono"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1em
  hero-badge:
    fontWeight: 400
    lineHeight: 20px
  hero-caption:
    fontWeight: 400
    lineHeight: 20px
  tab-item:
    fontFamily: "Neue Montreal"
    fontSize: 15px
    fontWeight: 400
  form-input:
    fontFamily: "Matter"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.2
spacing:
  columns: 12
  gutter: 2rem
  max-width: 90rem
  button-gap: 1rem
components:
  button-try-the-api-secondary-outline:
    backgroundColor: "transparent"
    textColor: "{colors.paper-white}"
  button-try-the-api-secondary-outline-hover:
    backgroundColor: "{colors.paper-white}"
    textColor: "#1E1E1E"
  button-join-our-team-text-arrow:
    backgroundColor: "transparent"
    textColor: "{colors.paper-white}"
  button-get-in-touch-secondary-outline:
    backgroundColor: "transparent"
    textColor: "{colors.paper-white}"
  button-get-in-touch-secondary-outline-hover:
    backgroundColor: "{colors.paper-white}"
    textColor: "#1E1E1E"
  button-explore-articles-text-arrow:
    backgroundColor: "transparent"
    textColor: "{colors.paper-white}"
  button-explore-text-link:
    backgroundColor: "transparent"
    textColor: "{colors.slate-gray}"
  button-explore-text-link-hover:
    backgroundColor: "transparent"
    textColor: "#1E1E1E"
  top-nav:
    backgroundColor: "#1E1E1E"
    height: 22.4px
---

# Taste

## Overview

Dark, monochromatic design with stark contrast between deep blacks (#1e1e1e, #111) and off-white/cream (#f5f7f2) sections. Bold, modern typography combining Matter sans-serif with Azeret Mono for technical credibility. Animated 3D card carousels, Lottie animations, and interactive elements create a sophisticated, research-lab aesthetic.

- **Style:** Brutalism, Corporate
- **Industry:** SaaS / AI
- **Tone:** Intellectual, Mission-driven, Technical
- **Keywords:** monochromatic, technical, editorial, research-driven, sophisticated, minimal
- **Accents:** Minimal accent color use; relies primarily on high contrast between black backgrounds and white/cream text with subtle grey (#8b8b8b) for secondary content. Occasional blue (#002bba) appears in interactive elements.
- **Highlights:** 3D rotating card carousels, Lottie SVG animations for mission visualization, draggable team marquee, and interactive swipe-based footer game create dynamic focal points against static dark backgrounds

## Colors

Brutalist Hyperlink Aesthetic: The bold, unadulterated #0000EE directly references default web hyperlinks, giving the brand a raw, technical, and engineer-focused feel that aligns with an API product.

Structural Inversion: The palette is built on stark reversals; the core black and paper white constantly swap roles between background and ink depending on the section (e.g., Dark Hero vs. Light Mission).

Monochromatic Restraint: By restricting the design to grayscales and one stark accent, the interface strips away subjectivity, fitting the brand's narrative of being a fundamental "infra layer" for AI.

- **Ink Black (#333333):** The foundational dark hue serving a dual purpose: as the immersive background for dark-themed sections and the primary text ink on light ones.
- **System Blue (#0000EE):** A raw, default web blue used exclusively as an interactive accent to highlight links and brand elements.
- **Paper White (#F5F7F2):** The primary light surface color and the inverse text color that provides stark, clean contrast against the dark layouts.
- **Void Black (#111111):** An ultra-dark contrast shade used to ground specific components or create subtle depth against the primary dark background.
- **Slate Gray (#8B8B8B):** A functional mid-gray applied to de-emphasize secondary text and draw subtle structural lines without overwhelming the content.

## Typography

The brand identity is heavily influenced by monospace and semi-monospace fonts (Azeret Semimono, Azeret Mono), giving it a distinct technical, AI-centric aesthetic.

Fluid typography is implemented extensively using CSS clamp(), allowing headings, body text, and even UI labels to scale seamlessly across viewports.

Matter is used as the primary workhorse sans-serif for high legibility in body copy and core headings, contrasting with the monospace elements used for data and UI accents.

## Layout

High-contrast color blocking (black/white/cream) creates bold section rhythm; each major section is a distinct color zone with deliberate palette shifts.

Generous vertical spacing (9rem default desktop padding) and centered layouts emphasize breathing room and hierarchy; mobile collapses to 4rem padding with stacked layouts.

Interactive 3D elements (carousel, draggable marquee, card swiper footer) add depth and engagement while maintaining clean, minimal structure; Lottie animations and GSAP transitions enhance cinematic feel.

Typography scale uses fluid clamp() for responsive sizing (global-headline-l: 2.5rem → 4rem); Azeret Semimono for UI, Matter for body, creating a modern, technical aesthetic.

Grid system is flexible: strict 12-column for desktop, collapses to single-column mobile, with intermediate 8-column tablet; custom 24-column grid available for fine-grained layouts.

Sections alternate between deep black (#1e1e1e), off-white/cream (#f5f7f2), pure white, and extra-dark black (#111). Transitions use gradient overlays (hero-bg, api-gradient) and generous vertical padding (9rem desktop, 4rem mobile). Horizontal strokes with gray opacity separate content blocks within sections. Navigation color transitions (nav-black-to-white, nav-white-to-dark-black) create visual continuity across color-block sections.

- **Mobile:** 0px - 767px (1 Column, 1.5rem gutter, fluid layout)
- **Tablet:** 768px - 991px (8 Columns, 2rem gutter)
- **Desktop:** 992px - 1439px (12 Columns, 2rem gutter, max-width 90rem)
- **Large:** 1440px+ (12 Columns, 2rem gutter, max-width 90rem)

## Elevation & Depth

- **Webflow Badge Shadow:** Composite shadow with 10% black border ring and subtle lift shadow. Used for the Webflow badge UI element. `0 0 0 1px #0000001a,0 1px 3px #0000001a`
- **Focus Ring Shadow:** 5px solid ring used for focus states on interactive elements like flickity buttons. `0 0 0 5px #19F`

- Navigation bar uses glassmorphism: -webkit-backdrop-filter: blur(30px); backdrop-filter: blur(30px); with background-color: #fffc (white with transparency)
- Copy email button hover effect with background transition: background: rgba(48, 48, 48, 0.9)
- Big video player button with glassmorphism: backdrop-filter: blur(1em); background-color: #64646433
- Lightbox play button with backdrop blur: backdrop-filter: blur(5px); background-color: #f5f5f54d
- Timeline progress bars with color overlays and opacity effects
- Animated rotating logo in blog section
- Swiper 3D effect with shadow overlays on carousel slides using rgba gradients
- Form notification backgrounds with 10% opacity overlay using currentColor
- Bunny player loading overlay: background-color: #00000054 with opacity transition

## Components

- **Try the API (Secondary Outline):** Navigation CTA button in header for API access
- **Join our team (Text Arrow):** Hero and careers CTA with decorative arrow icon
- **Get in touch (Secondary Outline):** Form submit button on dark cards for contact forms
- **Explore articles (Text Arrow):** Blog section CTA to navigate to full article listing
- **Explore (Text Link):** Article card footer link on blog cards

Buttons are typically placed inline with consistent spacing

The design system uses a brutalist hyperlink aesthetic with raw #0000EE blue for links, creating a technical/developer-focused feel appropriate for an AI infrastructure product.

Motion is primarily JS-driven (GSAP) with only basic CSS transitions for micro-interactions; the 3D carousel and marquees rely on JavaScript for their complex animations.

The component palette is highly restrained—relying almost exclusively on text-based buttons with arrow icons rather than filled CTAs, reinforcing the minimalist technical brand identity.

Extracted from https://www.tastelabs.com/ on 2026-10-26 with the Taste Engine, via taste-cli 0.0.1 (unofficial).
