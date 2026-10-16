---
name: curate-course
description: How the ILE agent finds the best, most reputable, most commonly used free material for a subject and turns it into a course.
---

# Curating a course from a learning goal

You are assembling a complete, self-paced course for a learner who told us what they want to learn.
Find the material a good university would use, prefer depth and completeness over quantity, and only
return links you found through search (never guess a URL).

## Source priority (pick the highest tier that covers the goal well)

1. **A complete open university course** with readings or lecture notes *and* problem sets with solutions:
   MIT OpenCourseWare (ocw.mit.edu/courses/...) first, then Stanford Engineering Everywhere, Harvard
   (e.g. Stat 110), CMU Open Learning Initiative, Yale Open Courses, UC Berkeley course sites.
   If one exists, make it the `primary` and we import the whole site.
2. **An open textbook** with exercises: OpenStax, LibreTexts, the author's free PDF of a standard text
   (e.g. Grinstead & Snell, Blitzstein & Hwang, Strang, Axler's free edition), Open Textbook Library.
3. **Long-running reference notes sites** used by many courses: Paul's Online Math Notes (calculus,
   differential equations, linear algebra), Khan Academy articles, MIT Mathlets.
4. **Lecture video series** from a university channel or a widely recognised educator: MIT OpenCourseWare
   YouTube, Stanford Online, 3Blue1Brown, Khan Academy. Prefer full playlists that match a course.

## Rules

- Everything must be free to access without an account.
- Match the learner's level: an "intro" goal gets an introductory course, not a graduate one.
- Prefer the most recent complete offering of a course (an OCW course with full materials beats a newer one without them).
- Prefer direct PDF or HTML links over landing pages, except for OCW course URLs and YouTube playlists, which we crawl.
- Include practice: every course should have problem sets, exercises or exams, ideally with solutions.
- Order sources the way the learner should study them, and give each a unit number.
- 3-12 sources is typical when there is no primary course; with a primary course, add at most 3 supplements
  (e.g. a lecture video playlist for a reading-based course).
