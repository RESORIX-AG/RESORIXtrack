CREATE TABLE `employment_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_employment_history_start` ON `employment_history` (`user_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `setting_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`valid_from` text NOT NULL,
	`value` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_setting_versions_key_from` ON `setting_versions` (`key`,`valid_from`);--> statement-breakpoint
CREATE TABLE `user_terms_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`valid_until` text NOT NULL,
	`timezone` text NOT NULL,
	`vacation_days_per_year` real NOT NULL,
	`legal_weekly_max_hours` integer NOT NULL,
	`recording_mode` text NOT NULL,
	`arg_exempt` integer NOT NULL,
	`regular_night_work` integer NOT NULL,
	`team_id` integer,
	`holiday_calendar_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%f000Z', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_terms_history_until` ON `user_terms_history` (`user_id`,`valid_until`);--> statement-breakpoint
ALTER TABLE `session` ADD `short` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- 1.x leftovers: the work log moved onto the time entries, two-factor re-enrolment after the 1.x import is done
DROP TRIGGER IF EXISTS trg_signoff_work_logs_ins;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_signoff_work_logs_upd;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_signoff_work_logs_del;
--> statement-breakpoint
DROP TABLE `work_logs`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `mfa_reenrol_required`;
--> statement-breakpoint
-- Setting versions and the base value of a versioned setting (settings.VERSIONED_SETTINGS) never reach a signed-off day.
-- Vacation now always follows the scheduled working days (the switch is retired).
DELETE FROM settings WHERE key = 'vacation_prorate_workdays';
--> statement-breakpoint
CREATE TRIGGER trg_signoff_setting_versions_ins BEFORE INSERT ON setting_versions FOR EACH ROW WHEN NEW.valid_from <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER trg_signoff_setting_versions_upd BEFORE UPDATE ON setting_versions FOR EACH ROW WHEN OLD.valid_from <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) OR NEW.valid_from <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER trg_signoff_setting_versions_del BEFORE DELETE ON setting_versions FOR EACH ROW WHEN OLD.valid_from <= (SELECT MAX(s.period_end_date) FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER trg_signoff_settings_base_upd BEFORE UPDATE ON settings FOR EACH ROW WHEN OLD.key IN ('holiday_mode', 'fulltime_weekly_minutes', 'holiday_work_surcharge_percent', 'holiday_work_surcharge_mode', 'compliance_enabled', 'night_work_permitted', 'sunday_work_permitted') AND NEW.value IS NOT OLD.value AND EXISTS (SELECT 1 FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER trg_signoff_settings_base_ins BEFORE INSERT ON settings FOR EACH ROW WHEN NEW.key IN ('holiday_mode', 'fulltime_weekly_minutes', 'holiday_work_surcharge_percent', 'holiday_work_surcharge_mode', 'compliance_enabled', 'night_work_permitted', 'sunday_work_permitted') AND EXISTS (SELECT 1 FROM month_signoffs s WHERE s.reopened_at IS NULL) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
-- Earlier terms: appended after the latest signed-off day only, never changed.
CREATE TRIGGER trg_signoff_terms_history_ins BEFORE INSERT ON user_terms_history FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND s.period_end_date > NEW.valid_until) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER trg_terms_history_no_update BEFORE UPDATE ON user_terms_history FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'resorixtrack: earlier terms are fixed'); END;
--> statement-breakpoint
CREATE TRIGGER trg_signoff_terms_history_del BEFORE DELETE ON user_terms_history FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND s.period_start_date <= OLD.valid_until) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
-- The current terms apply from the day after the latest earlier terms: a change reaching a signed-off day is refused.
CREATE TRIGGER trg_signoff_users_terms BEFORE UPDATE OF timezone, vacation_days_per_year, legal_weekly_max_hours, recording_mode, arg_exempt, regular_night_work, team_id, holiday_calendar_id ON users FOR EACH ROW WHEN (OLD.timezone IS NOT NEW.timezone OR OLD.vacation_days_per_year IS NOT NEW.vacation_days_per_year OR OLD.legal_weekly_max_hours IS NOT NEW.legal_weekly_max_hours OR OLD.recording_mode IS NOT NEW.recording_mode OR OLD.arg_exempt IS NOT NEW.arg_exempt OR OLD.regular_night_work IS NOT NEW.regular_night_work OR OLD.team_id IS NOT NEW.team_id OR OLD.holiday_calendar_id IS NOT NEW.holiday_calendar_id) AND EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.id AND s.reopened_at IS NULL AND s.period_end_date >= COALESCE((SELECT date(MAX(h.valid_until), '+1 day') FROM user_terms_history h WHERE h.user_id = OLD.id), '0001-01-01')) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
-- Employment dates: only the days that actually change are checked (moving a date back and forth, rehiring).
DROP TRIGGER IF EXISTS trg_signoff_users_employment;
--> statement-breakpoint
CREATE TRIGGER trg_signoff_users_employment BEFORE UPDATE OF employment_start, employment_end ON users FOR EACH ROW WHEN (OLD.employment_start IS NOT NEW.employment_start AND EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.id AND s.reopened_at IS NULL AND MAX(MIN(COALESCE(OLD.employment_start, '0001-01-01'), COALESCE(NEW.employment_start, '0001-01-01')), COALESCE((SELECT date(MAX(h.end_date), '+1 day') FROM employment_history h WHERE h.user_id = OLD.id), '0001-01-01')) <= s.period_end_date AND MAX(COALESCE(OLD.employment_start, '0001-01-01'), COALESCE(NEW.employment_start, '0001-01-01')) > s.period_start_date AND COALESCE(OLD.employment_end, '9999-12-31') >= s.period_start_date)) OR (OLD.employment_end IS NOT NEW.employment_end AND EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.id AND s.reopened_at IS NULL AND MAX(date(MIN(COALESCE(OLD.employment_end, '9999-12-31'), COALESCE(NEW.employment_end, '9999-12-31')), '+1 day'), COALESCE(NEW.employment_start, '0001-01-01')) <= s.period_end_date AND MAX(COALESCE(OLD.employment_end, '9999-12-31'), COALESCE(NEW.employment_end, '9999-12-31')) >= s.period_start_date)) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
-- Earlier employment periods: archiving the current period is the only way in; never changed.
CREATE TRIGGER trg_signoff_employment_history_ins BEFORE INSERT ON employment_history FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND s.period_start_date <= NEW.end_date AND s.period_end_date >= NEW.start_date) AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.employment_start IS NEW.start_date AND u.employment_end IS NEW.end_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
--> statement-breakpoint
CREATE TRIGGER trg_employment_history_no_update BEFORE UPDATE ON employment_history FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'resorixtrack: earlier employment periods are fixed'); END;
--> statement-breakpoint
CREATE TRIGGER trg_signoff_employment_history_del BEFORE DELETE ON employment_history FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = OLD.user_id AND s.reopened_at IS NULL AND s.period_start_date <= OLD.end_date AND s.period_end_date >= OLD.start_date) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
