ALTER TABLE `holiday_calendars` ADD `preset_days` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Presets are canton level only. The City of Fribourg preset had the same days as the canton; its calendars
-- become CH-FR. Commune days (public, but not in some communes) were always included, so existing calendars
-- keep them ticked and nothing in `holidays` changes.
UPDATE `holiday_calendars` SET `region_code` = 'CH-FR' WHERE `region_code` = 'ch-fr-fribourg';
--> statement-breakpoint
UPDATE `holiday_calendars`
  SET `preset_days` = '["Corpus Christi","Assumption Day","All Saints'' Day","Immaculate Conception"]'
  WHERE `region_code` = 'CH-FR';
--> statement-breakpoint
UPDATE `holiday_calendars` SET `preset_days` = '["Saint Joseph"]' WHERE `region_code` = 'CH-SO';
