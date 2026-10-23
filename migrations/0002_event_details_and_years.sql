ALTER TABLE gatherings ADD COLUMN game TEXT NOT NULL DEFAULT '';
ALTER TABLE gatherings ADD COLUMN location TEXT NOT NULL DEFAULT '';
UPDATE seasons SET name = CAST(strftime('%Y', 'now') AS TEXT) WHERE id = 1 AND name = 'Season 1';
UPDATE gatherings SET activity = 'Video Games', game = 'War Dogs' WHERE lower(trim(activity)) IN ('war dogs', 'wardogs');
