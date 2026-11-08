-- Projects move onto the time entries: an entry says what its time was spent on. The work_logs table stays
-- (read-only) because the seals of signed-off months cover it; open days are merged into the entries in code
-- after the migrations ran (src/server/db/legacy-worklogs.ts).
ALTER TABLE `time_entries` ADD `project_id` integer REFERENCES projects(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `ix_time_entries_project_start` ON `time_entries` (`project_id`,`start_at`);--> statement-breakpoint
-- the work log mode becomes the project mode; "required" now means every work entry has a project
UPDATE `settings` SET `key` = 'project_mode' WHERE `key` = 'worklog_mode'
  AND NOT EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'project_mode');--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('worklog_mode', 'worklog_required_percent', 'worklog_project_required');
