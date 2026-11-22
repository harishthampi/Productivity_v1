-- In-app account deletion (App Store / Play requirement).
-- Deleting the auth user cascades: users → tasks, logs, squads (+members), hosted events (+their invites), devices.
-- On other people's data the user's link is set to null (event_invites.invitee_user_id, squad_members.member_user_id).
create function public.delete_my_account() returns void
  language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
