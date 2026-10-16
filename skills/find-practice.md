---
name: find-practice
description: How the ILE agent finds problem sets, exams and projects (ideally with solutions) for an existing course.
---

# Finding practice material for a course

Given a course's topics and its existing material, find **Apply** material: problem sets, exercise
collections, practice exams, past exams, and projects. Only return links you found through search.

## Priorities

1. Problem sets and exams **with official solutions** from university courses on the same topics
   (MIT OCW first, then other universities' public course pages).
2. Exercise sections of open textbooks with answer keys (OpenStax, LibreTexts, free author PDFs).
3. Well-known practice collections (e.g. Paul's Online Notes practice problems, Harvard Stat 110 strategic practice).

## Rules

- Match the topics and level of the course; skip material that is mostly about topics the course does not cover.
- Prefer direct PDF links. For each problem document, give its solutions document if one exists (`solutionUrl`).
  Only pair a solutions document written for that exact assignment, never a whole-book answer key, and never the
  same file as the problems (a document that already contains its solutions needs no pair).
- Do not return material that is already in the course (you will be told what exists).
- Return 3-8 items, ordered from the earliest topics to the latest, each with the unit it fits best.
