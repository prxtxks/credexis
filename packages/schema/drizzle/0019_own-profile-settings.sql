-- M11.7: self-service profile settings. Users update ONLY their own
-- full_name and email_notifications through this definer — never a direct
-- RLS UPDATE, which could not stop a user from touching role/status/tenant
-- on their own row (RLS cannot restrict columns). Same narrow-definer
-- posture as accept_invite()/create_organization().
CREATE OR REPLACE FUNCTION public.update_own_profile(
  p_full_name text,
  p_email_notifications boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE profiles
     SET full_name = COALESCE(p_full_name, full_name),
         email_notifications = COALESCE(p_email_notifications, email_notifications),
         updated_at = now()
   WHERE id = auth.uid()
     AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active profile for this user';
  END IF;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.update_own_profile(text, boolean) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.update_own_profile(text, boolean) FROM anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, boolean) TO authenticated;
