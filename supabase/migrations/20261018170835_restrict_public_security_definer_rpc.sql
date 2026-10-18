DO $$
DECLARE
    target_function record;
BEGIN
    FOR target_function IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prosecdef
          AND has_function_privilege('anon', p.oid, 'EXECUTE')
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', target_function.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', target_function.signature);
    END LOOP;
END
$$;