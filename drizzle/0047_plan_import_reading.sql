ALTER TABLE "plan_imports" DROP CONSTRAINT "plan_imports_status_ck";--> statement-breakpoint
ALTER TABLE "plan_imports" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "plan_imports" ADD CONSTRAINT "plan_imports_status_ck" CHECK ("plan_imports"."status" in ('reading','failed','draft','imported','discarded'));