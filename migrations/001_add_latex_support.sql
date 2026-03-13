-- Add LaTeX support to projects table
-- Run this in Supabase SQL Editor

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'html',
  ADD COLUMN IF NOT EXISTS latex_source TEXT;

-- Add check constraint for valid formats
ALTER TABLE projects
  ADD CONSTRAINT projects_format_check CHECK (format IN ('html', 'latex'));

COMMENT ON COLUMN projects.format IS 'Content format: html (per-page HTML) or latex (whole-book XeLaTeX)';
COMMENT ON COLUMN projects.latex_source IS 'Full .tex document source for LaTeX projects (NULL for HTML projects)';
