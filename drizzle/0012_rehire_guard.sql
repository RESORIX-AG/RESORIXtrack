CREATE INDEX `ix_user_terms_history_calendar` ON `user_terms_history` (`holiday_calendar_id`);--> statement-breakpoint
CREATE INDEX `ix_users_calendar` ON `users` (`holiday_calendar_id`);--> statement-breakpoint
-- Archiving the current period on rehire is exempt also when no employment start was recorded: the archived start
-- (the account start) may not leave out a signed-off month that ends before it.
DROP TRIGGER trg_signoff_employment_history_ins;--> statement-breakpoint
CREATE TRIGGER trg_signoff_employment_history_ins BEFORE INSERT ON employment_history FOR EACH ROW WHEN EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND s.period_start_date <= NEW.end_date AND s.period_end_date >= NEW.start_date) AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.employment_end IS NEW.end_date AND (u.employment_start IS NEW.start_date OR (u.employment_start IS NULL AND NOT EXISTS (SELECT 1 FROM month_signoffs s WHERE s.user_id = NEW.user_id AND s.reopened_at IS NULL AND s.period_end_date < NEW.start_date)))) BEGIN SELECT RAISE(ABORT, 'resorixtrack: period signed off'); END;
