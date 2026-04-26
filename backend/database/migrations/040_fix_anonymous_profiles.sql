-- Migration: Fix Anonymous Profile Creation
-- Purpose: The application now uses Anonymous Sign-Ins, which do not provide an email address.
-- This was causing the "handle_new_user" trigger to fail because the "email" column in "public.profiles" was set to NOT NULL, preventing any new users from saving Q&A or creating interview profiles.

-- 1. Update the trigger to auto-generate a pseudo-email for anonymous users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, NEW.id::text || '@anonymous.user'),
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- 2. Backfill any existing anonymous users who failed to get a profile created
INSERT INTO public.profiles (id, email)
SELECT 
    id, 
    COALESCE(email, id::text || '@anonymous.user')
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;
