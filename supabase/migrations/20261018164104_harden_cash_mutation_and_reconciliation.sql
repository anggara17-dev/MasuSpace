CREATE OR REPLACE FUNCTION public.require_masupace_owner_auth()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Silakan masuk dengan akun Owner.' USING ERRCODE = '42501';
  END IF;

  SELECT au.id INTO v_owner_id
  FROM public.app_users AS au
  WHERE au.auth_user_id = auth.uid()
    AND au.role = 'owner'
    AND au.is_active = true
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Akses khusus Owner.' USING ERRCODE = '42501';
  END IF;

  RETURN v_owner_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.require_masupace_owner_auth() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_cash_sources()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public'
AS $function$
DECLARE result jsonb;
BEGIN
  PERFORM public.require_masupace_owner_auth();
  SELECT jsonb_agg(row_to_json(cs)) INTO result
  FROM public.cash_sources AS cs
  WHERE cs.is_active = true;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cash_sources() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_sources() TO authenticated;

CREATE OR REPLACE FUNCTION public.add_manual_mutation(
  p_source_id uuid, p_type text, p_amount numeric, p_description text, p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_mutation_id uuid;
  v_journal_id uuid;
  v_expense_account uuid;
  v_revenue_account uuid;
  v_balance numeric;
BEGIN
  v_owner_id := public.require_masupace_owner_auth();
  IF p_type NOT IN ('in', 'out') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Tipe harus in atau out');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Jumlah harus lebih dari 0');
  END IF;
  IF NULLIF(btrim(p_description), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Deskripsi wajib diisi');
  END IF;

  SELECT cs.current_balance INTO v_balance
  FROM public.cash_sources AS cs
  WHERE cs.id = p_source_id AND cs.is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sumber kas tidak ditemukan atau tidak aktif');
  END IF;
  IF p_type = 'out' AND v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'message', 'Saldo tidak cukup');
  END IF;

  UPDATE public.cash_sources
  SET current_balance = CASE WHEN p_type = 'in' THEN current_balance + p_amount ELSE current_balance - p_amount END
  WHERE id = p_source_id;

  INSERT INTO public.cash_mutations (source_id, type, amount, reference_type, description, created_by)
  VALUES (p_source_id, p_type, p_amount, 'manual', btrim(p_description), v_owner_id)
  RETURNING id INTO v_mutation_id;

  SELECT id INTO v_expense_account FROM public.chart_of_accounts WHERE code = '6000' LIMIT 1;
  SELECT id INTO v_revenue_account FROM public.chart_of_accounts WHERE code = '4000' LIMIT 1;
  IF p_type = 'out' AND v_expense_account IS NOT NULL THEN
    INSERT INTO public.journal_entries (date, description, reference_type, reference_id, created_by)
    VALUES (CURRENT_DATE, 'Manual: ' || btrim(p_description), 'manual', v_mutation_id, v_owner_id)
    RETURNING id INTO v_journal_id;
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (v_journal_id, v_expense_account, p_amount, 0);
  ELSIF p_type = 'in' AND v_revenue_account IS NOT NULL THEN
    INSERT INTO public.journal_entries (date, description, reference_type, reference_id, created_by)
    VALUES (CURRENT_DATE, 'Manual: ' || btrim(p_description), 'manual', v_mutation_id, v_owner_id)
    RETURNING id INTO v_journal_id;
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit)
    VALUES (v_journal_id, v_revenue_account, 0, p_amount);
  END IF;
  RETURN jsonb_build_object('success', true, 'mutation_id', v_mutation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_cash(
  p_from uuid, p_to uuid, p_amount numeric, p_desc text, p_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_balance numeric;
  v_source_count integer;
BEGIN
  v_owner_id := public.require_masupace_owner_auth();
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RETURN jsonb_build_object('success', false, 'message', 'Pilih sumber dan tujuan kas yang berbeda');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Jumlah harus lebih dari 0');
  END IF;

  PERFORM cs.id
  FROM public.cash_sources AS cs
  WHERE cs.id IN (p_from, p_to)
  ORDER BY cs.id
  FOR UPDATE;

  SELECT count(*) INTO v_source_count
  FROM public.cash_sources AS cs
  WHERE cs.id IN (p_from, p_to) AND cs.is_active = true;
  IF v_source_count <> 2 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sumber atau tujuan kas tidak ditemukan atau tidak aktif');
  END IF;

  SELECT cs.current_balance INTO v_balance
  FROM public.cash_sources AS cs WHERE cs.id = p_from;
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'message', 'Saldo tidak cukup');
  END IF;

  UPDATE public.cash_sources SET current_balance = current_balance - p_amount WHERE id = p_from;
  UPDATE public.cash_sources SET current_balance = current_balance + p_amount WHERE id = p_to;
  INSERT INTO public.cash_mutations (source_id, type, amount, reference_type, description, created_by)
  VALUES (p_from, 'out', p_amount, 'transfer', 'Transfer: ' || COALESCE(NULLIF(btrim(p_desc), ''), 'Antar kas'), v_owner_id);
  INSERT INTO public.cash_mutations (source_id, type, amount, reference_type, description, created_by)
  VALUES (p_to, 'in', p_amount, 'transfer', 'Terima: ' || COALESCE(NULLIF(btrim(p_desc), ''), 'Antar kas'), v_owner_id);
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_cash_balance(
  p_source_id uuid, p_physical_balance numeric, p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_current_balance numeric;
  v_difference numeric;
  v_mutation_id uuid;
BEGIN
  v_owner_id := public.require_masupace_owner_auth();
  IF p_physical_balance IS NULL OR p_physical_balance < 0
     OR p_physical_balance::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Saldo fisik harus berupa angka nol atau lebih');
  END IF;

  SELECT cs.current_balance INTO v_current_balance
  FROM public.cash_sources AS cs
  WHERE cs.id = p_source_id AND cs.is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sumber kas tidak ditemukan atau tidak aktif');
  END IF;

  v_difference := p_physical_balance - v_current_balance;
  IF v_difference = 0 THEN
    RETURN jsonb_build_object('success', true, 'no_change', true, 'difference', 0);
  END IF;

  UPDATE public.cash_sources SET current_balance = p_physical_balance WHERE id = p_source_id;
  INSERT INTO public.cash_mutations (source_id, type, amount, reference_type, description, created_by)
  VALUES (
    p_source_id,
    CASE WHEN v_difference > 0 THEN 'in' ELSE 'out' END,
    abs(v_difference),
    'adjustment',
    'Penyesuaian fisik: ' || COALESCE(NULLIF(btrim(p_description), ''), 'Selisih hitung fisik'),
    v_owner_id
  )
  RETURNING id INTO v_mutation_id;
  RETURN jsonb_build_object('success', true, 'difference', v_difference, 'mutation_id', v_mutation_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_cash_mutation(
  p_mutation_id uuid, p_new_amount numeric, p_new_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_mutation public.cash_mutations%ROWTYPE;
  v_current_balance numeric;
  v_new_balance numeric;
  v_amount_diff numeric;
  v_journal_id uuid;
BEGIN
  v_owner_id := public.require_masupace_owner_auth();
  IF p_new_amount IS NULL OR p_new_amount <= 0 OR p_new_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Jumlah harus lebih dari 0');
  END IF;

  SELECT * INTO v_mutation
  FROM public.cash_mutations
  WHERE id = p_mutation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Mutasi tidak ditemukan');
  END IF;
  IF v_mutation.reference_type NOT IN ('manual', 'adjustment') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Penjualan, pengeluaran, transfer, dan tutup kasir tidak dapat diedit dari mutasi');
  END IF;

  SELECT cs.current_balance INTO v_current_balance
  FROM public.cash_sources AS cs
  WHERE cs.id = v_mutation.source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sumber kas tidak ditemukan');
  END IF;

  v_amount_diff := p_new_amount - v_mutation.amount;
  v_new_balance := CASE
    WHEN v_mutation.type = 'in' THEN v_current_balance + v_amount_diff
    WHEN v_mutation.type = 'out' THEN v_current_balance - v_amount_diff
    ELSE NULL
  END;
  IF v_new_balance IS NULL OR v_new_balance < 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Saldo tidak cukup untuk perubahan ini');
  END IF;

  UPDATE public.cash_mutations
  SET amount = p_new_amount,
      description = COALESCE(NULLIF(btrim(p_new_description), ''), description)
  WHERE id = p_mutation_id;
  UPDATE public.cash_sources SET current_balance = v_new_balance WHERE id = v_mutation.source_id;

  SELECT id INTO v_journal_id
  FROM public.journal_entries
  WHERE reference_type = v_mutation.reference_type
    AND reference_id = COALESCE(v_mutation.reference_id, v_mutation.id);
  IF v_journal_id IS NOT NULL THEN
    UPDATE public.journal_entries
    SET description = COALESCE(NULLIF(btrim(p_new_description), ''), description)
    WHERE id = v_journal_id;
    UPDATE public.journal_lines SET debit = p_new_amount
    WHERE journal_entry_id = v_journal_id AND debit > 0;
    UPDATE public.journal_lines SET credit = p_new_amount
    WHERE journal_entry_id = v_journal_id AND credit > 0;
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_cash_mutation(p_mutation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog, public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_mutation public.cash_mutations%ROWTYPE;
  v_current_balance numeric;
  v_new_balance numeric;
  v_journal_id uuid;
BEGIN
  v_owner_id := public.require_masupace_owner_auth();
  SELECT * INTO v_mutation
  FROM public.cash_mutations
  WHERE id = p_mutation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Mutasi tidak ditemukan');
  END IF;
  IF v_mutation.reference_type NOT IN ('manual', 'adjustment') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Transaksi penjualan, pengeluaran, transfer, dan tutup kasir tidak dapat dihapus dari mutasi');
  END IF;

  SELECT cs.current_balance INTO v_current_balance
  FROM public.cash_sources AS cs
  WHERE cs.id = v_mutation.source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Sumber kas tidak ditemukan');
  END IF;

  v_new_balance := CASE
    WHEN v_mutation.type = 'in' THEN v_current_balance - v_mutation.amount
    WHEN v_mutation.type = 'out' THEN v_current_balance + v_mutation.amount
    ELSE NULL
  END;
  IF v_new_balance IS NULL OR v_new_balance < 0 THEN
    RETURN jsonb_build_object('success', false, 'message', 'Mutasi tidak dapat dibalik karena saldo kas tidak mencukupi');
  END IF;

  UPDATE public.cash_sources SET current_balance = v_new_balance WHERE id = v_mutation.source_id;
  SELECT id INTO v_journal_id
  FROM public.journal_entries
  WHERE reference_type = v_mutation.reference_type
    AND reference_id = COALESCE(v_mutation.reference_id, v_mutation.id);
  IF v_journal_id IS NOT NULL THEN
    DELETE FROM public.journal_lines WHERE journal_entry_id = v_journal_id;
    DELETE FROM public.journal_entries WHERE id = v_journal_id;
  END IF;
  DELETE FROM public.cash_mutations WHERE id = p_mutation_id;
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.add_manual_mutation(uuid,text,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_cash(uuid,uuid,numeric,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_cash_balance(uuid,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_cash_mutation(uuid,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_cash_mutation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_manual_mutation(uuid,text,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_cash(uuid,uuid,numeric,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_cash_balance(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_cash_mutation(uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cash_mutation(uuid) TO authenticated;

ALTER TABLE public.cash_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_mutations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_cash_sources ON public.cash_sources;
DROP POLICY IF EXISTS allow_all_cash_mutations ON public.cash_mutations;
DROP POLICY IF EXISTS cash_sources_owner_read ON public.cash_sources;
DROP POLICY IF EXISTS cash_mutations_owner_read ON public.cash_mutations;
CREATE POLICY cash_sources_owner_read ON public.cash_sources
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.app_users AS au
  WHERE au.auth_user_id = (SELECT auth.uid())
    AND au.role = 'owner' AND au.is_active = true
));
CREATE POLICY cash_mutations_owner_read ON public.cash_mutations
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.app_users AS au
  WHERE au.auth_user_id = (SELECT auth.uid())
    AND au.role = 'owner' AND au.is_active = true
));

REVOKE ALL ON TABLE public.cash_sources, public.cash_mutations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.cash_sources, public.cash_mutations TO authenticated;
GRANT ALL ON TABLE public.cash_sources, public.cash_mutations TO service_role;