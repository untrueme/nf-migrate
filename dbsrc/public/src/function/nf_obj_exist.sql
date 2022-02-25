CREATE OR REPLACE FUNCTION public.nf_obj_exist(p_object_type text, p_schema text, p_object_name text DEFAULT NULL::text, p_subobject_name text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
select case p_object_type when 'function' then (select exists (select t2.oid
                                                   from pg_catalog.pg_namespace   t1,
                                                        pg_catalog.pg_proc        t2
                                                  where t1.nspname      = p_schema
                                                    and t2.pronamespace = t1.oid 
                                                    and t2.proname      = p_object_name))
                           when 'view' then (select exists (select t2.oid
                                               from pg_catalog.pg_namespace   t1,
                                                    pg_catalog.pg_class       t2
                                              where t1.nspname      = p_schema
                                                and t2.relnamespace = t1.oid 
                                                and t2.relkind     = 'v'
                                                and t2.relname      = p_object_name))
                           when 'table' then  (select exists (select t2.oid
                                                 from pg_catalog.pg_namespace   t1,
                                                      pg_catalog.pg_class       t2
                                                where t1.nspname      = p_schema
                                                  and t2.relnamespace = t1.oid 
                                                  and t2.relkind     = 'r'
                                                  and t2.relname      = p_object_name))
                           when 'column' then (select exists (select q.oid
                                                 from (select t2.oid
                                                         from pg_catalog.pg_namespace   t1,
                                                              pg_catalog.pg_class       t2,
                                                              pg_catalog.pg_attribute   t3
                                                        where t1.nspname      = p_schema
                                                          and t2.relnamespace = t1.oid 
                                                          and t2.relname      = p_object_name
                                                          and t3.attrelid     = t2.oid
                                                          and t3.attname      = p_subobject_name
                                                        limit 1) q))
                           when 'trigger' then (select exists (select t2.oid
                                                  from pg_catalog.pg_namespace   t1,
                                                       pg_catalog.pg_class       t3,
                                                       pg_catalog.pg_trigger     t2
                                                 where t1.nspname      = p_schema
                                                   and t3.relnamespace = t1.oid
                                                   and t2.tgrelid      = t3.oid
                                                   and t2.tgname       = p_object_name))
                           when 'constraint' then (select exists (select t3.oid  
                                                     from pg_catalog.pg_namespace   t1,
                                                          pg_catalog.pg_constraint  t3
                                                    where (t1.nspname     = p_schema or p_schema is null)
                                                      and t3.connamespace = t1.oid
                                                      and t3.conname      = p_object_name))                         
                           when 'role' then (select exists (select t.oid from pg_catalog.pg_roles t where t.rolname = p_schema))
                           when 'sequence' then (select exists (select t2.oid
                                                 from pg_catalog.pg_namespace   t1,
                                                      pg_catalog.pg_class       t2
                                                where t1.nspname      = p_schema
                                                  and t2.relnamespace = t1.oid 
                                                  and t2.relkind     = 'S'
                                                  and t2.relname      = p_object_name))
                           else false
                           end
$function$
;