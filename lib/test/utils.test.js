/* eslint-env mocha */
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { sortDependent, checkObjName, extractTableName, extractTableNameFromTrigger, extractFunctionIdentity, extractFunctionReturns } from '../utils.js';

describe('@nfjs/migrate/lib/utils.js', () => {
    describe('sortDepended()', () => {
        const objs = [
            { fullname: 'test.view', type: 'view', dependent: [{ fullname: 'test.table', type: 'table' }, { fullname: 'test.function', type: 'function' }] },
            { fullname: 'test.table', type: 'table' },
            { fullname: 'test.trigger', type: 'trigger', dependent: [{ fullname: 'test.table', type: 'table' }, { fullname: 'test.function', type: 'function' }] },
            { fullname: 'test.function', type: 'function', dependent: [{ fullname: 'test.table', type: 'table' }] },
            { fullname: 'test.sequence', type: 'sequence' }
        ];
        it('check', () => {
            // Arrange
            // Act
            const res = sortDependent(objs);
            // Assert
            const viewIndex = res.findIndex(i => i.fullname === 'test.view');
            const tableIndex = res.findIndex(i => i.fullname === 'test.table');
            const functionIndex = res.findIndex(i => i.fullname === 'test.function');
            const triggerIndex = res.findIndex(i => i.fullname === 'test.trigger');
            expect(viewIndex, 'view must be after table').to.be.greaterThan(tableIndex);
            expect(viewIndex, 'view must be after function').to.be.greaterThan(functionIndex);
            expect(triggerIndex, 'trigger must be after table').to.be.greaterThan(tableIndex);
        });
    });

    const tablename = 'te_st4tab_le8na_me8';
    describe('checkObjName()', () => {
        it('right1', () => {
            expect(checkObjName('i4te_st4tab_le8na_me88fld', tablename)).to.equal(true);
        });
        it('right2', () => {
            expect(checkObjName('i4te_st4tab_le8na_me8', tablename)).to.equal(true);
        });
        it('right3', () => {
            expect(checkObjName('loooong4te_st4tab_le8na_me88loooong', tablename)).to.equal(true);
        });
        it('wrong1', () => {
            expect(checkObjName('i4te_st4tab_le8na_me8fld', tablename)).to.equal(false);
        });
        it('wrong2', () => {
            expect(checkObjName('i4te_st4tab_le8na_me88', tablename)).to.equal(false);
        });
        it('wrong3', () => {
            expect(checkObjName('ite_st4tab_le8na_me8', tablename)).to.equal(false);
        });
        it('wrong4', () => {
            expect(checkObjName('4te_st4tab_le8na_me8', tablename)).to.equal(false);
        });
        it('wrong5', () => {
            expect(checkObjName('i4te_st4table8na_me8', tablename)).to.equal(false);
        });
        it('wrong6', () => {
            expect(checkObjName('idx_table_field', tablename)).to.equal(false);
        });
    });
    describe('extractTableName()', () => {
        const tableName = 'user4roles8table';
        it('trigger = sct.tr4user4roles8table8checks', () => {
            expect(extractTableName('tr4user4roles8table8checks')).to.equal(tableName);
        });
    });
    describe('extractTableNameFromTrigger()', () => {
        const triggerSource = 'CREATE CONSTRAINT TRIGGER tr4table8checks_deferred AFTER INSERT OR UPDATE ON schema.tablename DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE PROCEDURE schema.f4table8tr_checks_deferred();';
        it('tablename with schema', () => {
            expect(extractTableNameFromTrigger(triggerSource, true)).to.equal('schema.tablename');
        });
        it('tablename without schema', () => {
            expect(extractTableNameFromTrigger(triggerSource, false)).to.equal('tablename');
        });
    });
    describe('extractFunctionIdentity()', () => {
        it('simple', () => {
            const functionSource = `CREATE OR REPLACE FUNCTION nfc.f4modulelist8mod(p_code character varying, p_caption character varying)
                            RETURNS void
                                LANGUAGE plpgsql
                            SECURITY DEFINER
                            begin nfc.f4modulelist8mod(p_code); somefunc();end;`;
            const expected = 'p_code character varying, p_caption character varying';
            expect(extractFunctionIdentity(functionSource)).to.equal(expected);
        });
        it('simple default', () => {
            const functionSource = `CREATE OR REPLACE FUNCTION public.nf_obj_exist(p_object_type text, p_schema text, p_object_name text DEFAULT NULL::text, p_subobject_name text DEFAULT NULL::text)
                                RETURNS boolean begin nfc.f4modulelist8mod(p_code); somefunc();end;`;
            const expected = 'p_object_type text, p_schema text, p_object_name text, p_subobject_name text';
            expect(extractFunctionIdentity(functionSource)).to.equal(expected);
        });
        it('hard default', () => {
            const functionSource = `CREATE OR REPLACE FUNCTION public.nf_obj_exist(p_date_from timestamp with time zone DEFAULT date_trunc('month'::text, '2017-12-31 20:00:00+03'::timestamp with time zone), p_date_to timestamp with time zone DEFAULT (CURRENT_DATE)::timestamp with time zone, p_mo_oid text DEFAULT ';,odp('::text)
                                RETURNS boolean begin nfc.f4modulelist8mod(p_code); somefunc();end;`;
            const expected = 'p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_mo_oid text';
            expect(extractFunctionIdentity(functionSource)).to.equal(expected);
        });
    });
    describe('extractFunctionReturns()', () => {
        it('simple', () => {
            const functionSource = `CREATE OR REPLACE FUNCTION nfc.f4modulelist8mod(p_code character varying, p_caption character varying)
                            RETURNS void
                                LANGUAGE plpgsql
                            SECURITY DEFINER
                            begin nfc.f4modulelist8mod(p_code); somefunc();end;`;
            const expected = 'void';
            expect(extractFunctionReturns(functionSource)).to.equal(expected);
        });
        it('table', () => {
            const functionSource = `CREATE OR REPLACE FUNCTION public.nf_obj_exist(p_object_type text, p_schema text, p_object_name text DEFAULT NULL::text, p_subobject_name text DEFAULT NULL::text)
                                RETURNS TABLE(id integer, name text, ord integer) begin nfc.f4modulelist8mod(p_code); somefunc();end;`;
            const expected = 'table(id integer, name text, ord integer)';
            expect(extractFunctionReturns(functionSource)).to.equal(expected);
        });
    });
});
