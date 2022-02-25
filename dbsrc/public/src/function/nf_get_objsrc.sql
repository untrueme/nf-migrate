CREATE OR REPLACE FUNCTION public.nf_get_objsrc(p_object_type text, p_schema text, p_object_name text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
    v_obj json;
    v_src text;
    v_descr text;
    v_oid oid;
    v_full text = p_schema||'.'||p_object_name;
    v_tmp text;
begin
    if p_object_type = 'table' then
        select row_to_json(alls)
          into v_obj
          from (
        select  sch.nspname as schema,
                tabl.relname as tablename,
                d.description as comment,
                (select array_to_json(array_agg(row_to_json(col)))
                  from (select
                              t3.attname as name,
                              t4.typname as datatype,
                              substring(pg_catalog.format_type(t3.atttypid, t3.atttypmod) from '\((.+)\)') datatype_length,
                              pg_catalog.format_type(t3.atttypid, t3.atttypmod) as datatype_full,
                              t3.attnotnull as required,
                              pg_get_expr(d.adbin, t3.attrelid, true) as default_value,
                              ds.description as comment,
                              (select fks.nspname||'.'||fk.relname
                                 from pg_catalog.pg_constraint  fk_cns
                                      join pg_catalog.pg_class fk on (fk.oid = fk_cns.confrelid)
                                      join pg_catalog.pg_namespace fks on (fks.oid = fk.relnamespace)

                                where fk_cns.conrelid = tabl.oid
                                  and t3.attnum = any(fk_cns.conkey)
                                 limit 1)
                               as fk_tablename,
                              t3.attnum as column_id
                         from pg_catalog.pg_attribute   t3
                              left join pg_catalog.pg_attrdef d on d.adrelid = t3.attrelid and d.adnum = t3.attnum
                              left join pg_catalog.pg_description ds on ds.objoid = t3.attrelid and ds.objsubid = t3.attnum
                              join pg_catalog.pg_type t4 on t4.oid = t3.atttypid
                        where t3.attrelid = tabl.oid
                          and t3.attnum       > 0
                          and not t3.attisdropped
                        order by t3.attnum asc) col) as cols,
               (select array_to_json(array_agg(row_to_json(con)))
                  from (select t.conname as name,
                                n.nspname as schema,
                                t.contype as type,
                                nullif(t.confupdtype,' ') as update_rule,
                                nullif(t.confdeltype,' ') as delete_rule,
                                pg_get_expr(t.conbin, t.conrelid) as condition,
                                pg_catalog.pg_get_constraintdef(t.oid, true) definition,
                                fn.nspname as r_schema,
                                f.relname as r_tablename,
                                (select fa.attname
                                   from pg_catalog.pg_attribute fa
                                  where fa.attrelid = f.oid
                                    and fa.attnum = t.confkey[1]) as r_columnname,
                                (select array_to_string(array(
                                  select (select a.attname::text
                                            from pg_catalog.pg_attribute a
                                           where a.attrelid = t.conrelid
                                             and a.attnum = g.arr[g.rn])
                                    from (select t.conkey as arr, generate_subscripts(t.conkey, 1) as rn) g
                                   order by g.rn),',')) as columns,
                                ds.description as comment,
                                case when t.condeferrable then
                                    case when t.condeferred then 'deferred' else 'immediate' end
                                else null end as deferrable
                           from pg_catalog.pg_constraint t
                                join pg_catalog.pg_namespace n on n.oid = t.connamespace
                                left join pg_catalog.pg_class f
                                          join pg_catalog.pg_namespace fn on fn.oid = f.relnamespace
                                       on f.oid = t.confrelid
                                left join pg_catalog.pg_description ds on ds.objoid = t.oid
                          where t.conrelid = tabl.oid
                            and t.contype != 't' -- отдельно сам триггер типа ограничение создает
                          order by t.conname) con) as cons,
               (select array_to_json(array_agg(row_to_json(ind)))
                 from (select c2.relname as name,
                               n2.nspname as schema,
                               (select array(
                                  select jsonb_build_object('name',(select a.attname::text as name
                                                                      from pg_catalog.pg_attribute a
                                                                     where a.attrelid = i.indrelid
                                                                       and a.attnum = i.indkey[g.rn]),
                                                            'collate',(select ns.nspname||'.'||pg_catalog.quote_ident(coll.collname)
                                                                         from pg_catalog.pg_collation coll
                                                                              join pg_catalog.pg_namespace ns on ns.oid = coll.collnamespace
                                                                        where coll.oid = i.indcollation[g.rn]),
                                                            'order', case when i.indoption[g.rn] in (0,2) then 'asc' else 'desc' end,
                                                            'nulls', case when i.indoption[g.rn] in (0,1) then 'last' else 'first' end)
                                    from (select generate_subscripts(i.indkey, 1) as rn) g
                                   order by g.rn)) as columns,
                               i.indisunique as is_unique,
                               am.amname as method,
                               t2.spcname as tablespace,
                               pg_catalog.pg_get_indexdef(i.indexrelid, 0, true) definition
                          from pg_catalog.pg_index i
                               join pg_catalog.pg_class c2 on (c2.oid = i.indexrelid)
                               join pg_catalog.pg_namespace n2 on (n2.oid = c2.relnamespace)
                               left join pg_catalog.pg_tablespace t2 on (t2.oid = c2.reltablespace)
                               join pg_catalog.pg_am as am on (am.oid = c2.relam)
                         where i.indrelid = tabl.oid
                           and not exists (select null from pg_catalog.pg_constraint con where con.conrelid = i.indrelid and con.conindid = i.indexrelid and contype in ('p','u','x'))
                         order by c2.relname) ind) as indx
          from pg_catalog.pg_class tabl
               join pg_catalog.pg_namespace sch on sch.oid = tabl.relnamespace
               left join pg_catalog.pg_description d on (d.objoid = tabl.oid and d.objsubid = 0)
         where sch.nspname = p_schema
           and tabl.relname = p_object_name) alls;
    elsif p_object_type = 'view' then
        select cl.oid, d.description
          into v_oid, v_descr
          from pg_catalog.pg_class cl
               join pg_catalog.pg_namespace sch on sch.oid = cl.relnamespace
               left join pg_catalog.pg_description d on (d.objoid = cl.oid and d.objsubid = 0)
         where sch.nspname = p_schema
           and cl.relname = p_object_name
           and cl.relkind = 'v'::char;
        if v_oid is not null then
            v_src = 'create or replace view '||v_full||' as '||chr(10)||pg_catalog.pg_get_viewdef(v_oid, true);
            if coalesce(v_descr,'')::text != ''::text then
                v_src := v_src||chr(10)||'comment on view '||v_full||' is '||pg_catalog.quote_literal(v_descr)||';';
            end if;
            v_obj = json_build_object('src',v_src);
        end if;
    elsif p_object_type = 'function' then
        select t2.oid
          into v_oid
          from pg_catalog.pg_namespace   t1,
               pg_catalog.pg_proc        t2
         where t1.nspname      = p_schema
           and t2.pronamespace = t1.oid
           and t2.proname      = p_object_name;
        if v_oid is not null then
            v_descr = pg_catalog.obj_description(v_oid, 'pg_proc');
            v_src := pg_catalog.pg_get_functiondef(v_oid)||';';
            if coalesce(v_descr,'')::text != ''::text then
                v_src := v_src||chr(10)||'comment on function '||v_full||'('||pg_catalog.pg_get_function_identity_arguments(v_oid)||') is '||pg_catalog.quote_literal(v_descr)||';';
            end if;
            v_obj = json_build_object('src',v_src,'identity_arguments',pg_catalog.pg_get_function_identity_arguments(v_oid));
        end if;
    elsif p_object_type = 'trigger' then
        select t2.oid, t3.relname
          into v_oid, v_tmp
          from pg_catalog.pg_namespace   t1,
               pg_catalog.pg_class       t3,
               pg_catalog.pg_trigger     t2
         where t1.nspname      = p_schema
           and t3.relnamespace = t1.oid
           and t2.tgrelid      = t3.oid
           and t2.tgname       = p_object_name;
        if v_oid is not null then
            v_descr = pg_catalog.obj_description(v_oid, 'pg_trigger');
            v_src := pg_catalog.pg_get_triggerdef(v_oid, true)||';'||chr(10);
            if coalesce(v_descr,'')::text != ''::text then
                v_src := v_src||chr(10)||format('comment on trigger %I on %I.%I is %L', p_object_name, p_schema, v_tmp, v_descr)||';';
            end if;
            v_obj = json_build_object('src',v_src);
        end if;
    elsif p_object_type = 'sequence' then
        select json_build_object('start', s.start_value::bigint,
                       'minvalue', s.minimum_value::bigint,
                       'maxvalue', s.maximum_value::bigint,
                       'increment', s.increment::bigint,
                       'cycle', (case when s.cycle_option = 'NO' then false else true end),
                       'cache', 1)
          into v_obj
          from information_schema.sequences s
         where s.sequence_schema = p_schema
           and s.sequence_name = p_object_name;
        /*
        select json_build_object('start', s.seqstart,
               'minvalue', s.seqmin,
               'maxvalue', s.seqmax,
               'increment', s.seqincrement,
               'cycle', s.seqcycle,
               'cache', s.seqcache)
          into v_obj
          from pg_catalog.pg_namespace nc
               join pg_catalog.pg_class c on (c.relnamespace = nc.oid and c.relkind = 'S'::"char")
               join pg_catalog.pg_sequence s on (s.seqrelid = c.oid)
         where nc.nspname = p_schema
           and c.relname = p_object_name;
        */
    else
    end if;
    return v_obj;
end;
$function$
;