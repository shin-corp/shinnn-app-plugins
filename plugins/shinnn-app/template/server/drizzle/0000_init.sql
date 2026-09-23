CREATE TYPE "public"."item_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(1000),
	"status" "item_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "items_owner_id_name_key" ON "items" USING btree ("owner_id","name");