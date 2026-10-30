-- Runtime settings writes use narrow column grants; authorization remains owner-only in the API.
grant update(tab_reopen_roles) on app.tenants to comandei_api;
