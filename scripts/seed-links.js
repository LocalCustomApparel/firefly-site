'use strict';
// One-off, idempotent: seed curated links for models. Safe to re-run — skips any
// (modelSlug, url) pair already present in model_links.
const cfg = require('../config');
const wdb = require('../db/wiki').open(cfg.FFWIKI_DB);

// All URLs verified live (HTTP 200 / YouTube oEmbed 200) on 2026-07-10 before inclusion.
const LINKS = [
  { modelSlug: 'ffhb', kind: 'youtube', url: 'https://www.youtube.com/watch?v=ciefKLbVkkw', title: 'Firefly Crossroads FFHB: is it the same as a Grote hollow jazz guitar?' },
  { modelSlug: 'ffhb', kind: 'youtube', url: 'https://www.youtube.com/watch?v=H-z1xe-vdoo', title: 'Brutally honest, unedited review of Firefly\'s hollow body' },

  { modelSlug: 'fflps', kind: 'review', url: 'https://artofshred.com/firefly-fflps/', title: 'Art of Shred: Firefly FFLPS review' },
  { modelSlug: 'fflps', kind: 'review', url: 'https://gear-report.com/best-budget-electric-guitar-firefly-fflp-elite-electric-guitar-review-2/', title: 'Gear Report: Firefly FFLP Elite review' },
  { modelSlug: 'fflps', kind: 'youtube', url: 'https://www.youtube.com/watch?v=6EFeq6mff98', title: 'Is this $250 Firefly FFLP better than a Gibson/Epiphone?' },
  { modelSlug: 'fflps', kind: 'youtube', url: 'https://www.youtube.com/watch?v=8Y1GABeKaDU', title: 'Love it or hate it? FFLPS full demo and review' },

  { modelSlug: 'ffsp', kind: 'youtube', url: 'https://www.youtube.com/watch?v=ybUWEynRSxU', title: 'This guitar is not what I expected — Firefly FFSP review' },
  { modelSlug: 'ffsp', kind: 'youtube', url: 'https://www.youtube.com/watch?v=_36RHSgfKCI', title: 'Firefly FFSP 3-pickup Blue Sparkle Burst — review & demo' },
  { modelSlug: 'ffsp', kind: 'review', url: 'https://artofshred.com/firefly-guitars/', title: 'Art of Shred: Are Firefly guitars good?' },

  { modelSlug: 'ffst', kind: 'youtube', url: 'https://www.youtube.com/watch?v=pkMl3BCO8Rw', title: 'Firefly FFST Relic — big bang for the buck' },
  { modelSlug: 'ffst', kind: 'youtube', url: 'https://www.youtube.com/watch?v=dYlcCo6-T8s', title: 'Firefly FFST Classic Relic Strat — amazing value' },
  { modelSlug: 'ffst', kind: 'review', url: 'https://artofshred.com/firefly-guitars/', title: 'Art of Shred: Are Firefly guitars good?' },

  { modelSlug: 'fftl', kind: 'youtube', url: 'https://www.youtube.com/watch?v=CIZRkqLVxZ8', title: 'Firefly Mad Cat FFTL full detail review' },
  { modelSlug: 'fftl', kind: 'forum', url: 'https://offsetguitars.com/forums/index.php?threads/firefly-mad-cat-vs-eastwood.129012/', title: 'OffsetGuitars: Firefly Mad Cat vs Eastwood' },

  { modelSlug: 'ffsps', kind: 'youtube', url: 'https://www.youtube.com/watch?v=UH17fObZbDo', title: 'Firefly FFSPS LP-style unboxing review' },
  { modelSlug: 'ffsps', kind: 'youtube', url: 'https://www.youtube.com/watch?v=2h3xWIJa-To', title: 'Firefly FFSPS Camo Bullseye — review & demo' },

  { modelSlug: 'fflgs', kind: 'review', url: 'https://artofshred.com/firefly-fflg/', title: 'Art of Shred: Firefly FFLG (SG-style) review' },
  { modelSlug: 'fflgs', kind: 'review', url: 'https://gear-report.com/firefly-fflg-classic-electric-guitar-review/', title: 'Gear Report: Firefly FFLG Classic review' },
  { modelSlug: 'fflgs', kind: 'youtube', url: 'https://www.youtube.com/watch?v=gJ3pkZnwfZQ', title: 'Firefly FFLGS SG-type — unboxing and review' },

  { modelSlug: 'fflx', kind: 'review', url: 'https://artofshred.com/firefly-guitars/', title: 'Art of Shred: Are Firefly guitars good?' },
  { modelSlug: 'fflx', kind: 'forum', url: 'https://www.vsplanet.com/ubbthreads/ubbthreads.php?ubb=showflat&Number=1944211', title: 'VS-Planet: Firefly baritone discussion' },

  { modelSlug: 'fflv', kind: 'forum', url: 'https://www.thetonerooms.com/threads/ngd-firefly-fflv-flying-v.14351/', title: 'The Tone Rooms: NGD — Firefly FFLV Flying V' },
  { modelSlug: 'fflv', kind: 'youtube', url: 'https://www.youtube.com/watch?v=kThcNkwoPzU', title: 'Firefly FFLV — is this $219 V an Epiphone killer?' },
  { modelSlug: 'fflv', kind: 'youtube', url: 'https://www.youtube.com/watch?v=5YgoALaON6I', title: 'Firefly FFLV review and demo' },

  { modelSlug: 'ffvx', kind: 'youtube', url: 'https://www.youtube.com/watch?v=UD9OMc1h7cU', title: 'Firefly FFVX review: ultimate Dime-style guitar for cheap?' },
  { modelSlug: 'ffvx', kind: 'youtube', url: 'https://www.youtube.com/watch?v=yNCozEPlWck', title: 'Dimebag fans will love this — Firefly FFVX review' },
  { modelSlug: 'ffvx', kind: 'youtube', url: 'https://www.youtube.com/watch?v=O9akfWmHm8I', title: 'Firefly FFVX — review & demo' },

  { modelSlug: 'ffja', kind: 'youtube', url: 'https://www.youtube.com/watch?v=Md6efB2mlus', title: 'Firefly FFJA guitar review and demo' },
  { modelSlug: 'ffja', kind: 'youtube', url: 'https://www.youtube.com/watch?v=6BuQ_rKrI4A', title: 'Firefly FFJA 30" baritone Jazzmaster — review & demo' },
  { modelSlug: 'ffja', kind: 'forum', url: 'https://www.thetonerooms.com/threads/ancgd-another-new-cheapy-guitar-day-firefly-ffja.14587/', title: 'The Tone Rooms: another new cheapy guitar day — Firefly FFJA' },

  { modelSlug: 'ffdb', kind: 'youtube', url: 'https://www.youtube.com/watch?v=iM-js-JCiAU', title: '$250 Firebird-style guitar that shreds? Firefly FFDB full review' },
  { modelSlug: 'ffdb', kind: 'youtube', url: 'https://www.youtube.com/watch?v=Eu-N63aIoyE', title: 'New Firefly Firebird first look — FFDB Classic review' },
];

let added = 0, skipped = 0;
for (const l of LINKS) {
  const existing = wdb.linksFor(l.modelSlug).some(x => x.url === l.url);
  if (existing) { skipped++; continue; }
  wdb.addLink(l);
  added++;
}
console.log(`[seed-links] added ${added}, already-present ${skipped}`);
wdb.close();
