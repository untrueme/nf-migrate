import { join } from 'path';
import { createReadStream } from 'fs';
import { api, common, config, extension } from '@nfjs/core';
import { DboSequence, DboTable } from '@nfjs/dbo-compare';
import { NFLoad, NFExtract } from '@nfjs/ei';
import { Writable } from 'stream';

import {
    random,
    writeFile,
    readFile,
    mkdir,
    getHash,
    sortArrayByName,
    getSchemaModules,
    extractFunctionIdentity,
    extractFunctionReturns,
    checkObjName,
    dropTrigger,
    dropFunction,
    dropView
} from './utils.js';

/**
 * Класс-помощник для накопления dml операторов в массив при загрузке из файла данных
 */
class NFcomposeArr extends Writable {
    constructor() {
        super({ objectMode: true });
        this.arr = [];
    }

    _write(chunk, encoding, done) {
        if (typeof chunk === 'object') {
            this.arr.push(...chunk.arr);
        }
        done();
    }
}

/**
 * Класс соединения с базой данных. Оперирования с объектами поддержки миграций(проверка необходимости и отметка
 * о выполнении) и само выполнение обновления
 */
class NFMigDb {
    constructor(provider) {
        this.provider = provider;
        this.config = common.getPath(config, `@nfjs/migrate.data_providers.${provider.name}`);
        this.checkCredentials = {
            user: common.getPath(this.config, 'checkUserName'),
            password: common.getPath(this.config, 'checkUserPassword'),
        };
        this.adminCredentials = {
            user: common.getPath(this.config, 'adminUserName'),
            password: common.getPath(this.config, 'adminUserPassword'),
        };
        this.superCredentials = {
            user: common.getPath(this.config, 'superUserName'),
            password: common.getPath(this.config, 'superUserPassword'),
        };
        const argv = common.getPath(api, 'argv');
        if ('migrate-check-user-name' in argv)
            this.checkCredentials.user = argv['migrate-check-user-name'];
        if ('migrate-check-user-password' in argv)
            this.checkCredentials.password = argv['migrate-check-user-password'];
        if ('migrate-admin-user-name' in argv)
            this.adminCredentials.user = argv['migrate-admin-user-name'];
        if ('migrate-admin-user-password' in argv)
            this.adminCredentials.password = argv['migrate-admin-user-password'];
        this.dbsrcDirectory = join(process.cwd(), 'node_modules', '@nfjs/migrate/dbsrc/public/src');
    }

    /**
     * Выполенение запроса в бд в одно из двух подкюченных соединений checkConnect - для безопасных операций(проверок
     * необходимости выполнения того или иного блока), adminConnect - для выполнения самого обновления и отметках
     * о его проведении
     * @param {string} sql - выполняемый запрос в базу данных
     * @param {Array} params - параметры для запроса, массив с разнотиповыми элементами
     * @param {string} connectType - тип соединения в котором выполнить запрос
     * @param {boolean} [needFormat=false] - необходимость преобразования параматров в запросе из :param в $1 нотацию
     * @returns {Promise<*>}
     */
    async query(sql, params, connectType, needFormat = false) {
        const query = { sql: '', params: [] };
        if (needFormat) {
            this.provider.formatQuery({ sql, params }, query);
        } else {
            query.sql = sql;
            query.params = params || [];
        }
        return this[connectType].query(query.sql, query.params);
    }

    /**
     * Получение соединения с базой данных через выбранного при конструкции экземляра провайдера данных
     * @param {Object} credentials - user,password соединения
     * @param {string} connectType - тип соединения checkConnect|adminConnect
     * @returns {Promise<void>}
     */
    async connect(credentials, connectType) {
        if (!this[connectType]) {
            this[connectType] = await this.provider.getConnect(credentials, { forceCredentials: true });
        }
    }

    /**
     * Начать транзакцию в указанном соединении
     * @param {string} connectType - тип соединения checkConnect|adminConnect
     * @returns {Promise<*>}
     */
    async startTransaction(connectType) {
        return this.provider.startTransaction(this[connectType]);
    }

    /**
     * Подтвердить транзакцию в указанном соединении
     * @param {string} connectType - тип соединения checkConnect|adminConnect
     * @returns {Promise<*>}
     */
    async commit(connectType) {
        if (this[connectType]) {
            return this.provider.commit(this[connectType]);
        }
        return Promise.resolve();
    }

    /**
     * Отменить транзакцию в указанном соединении
     * @param {string} connectType - тип соединения checkConnect|adminConnect
     * @returns {Promise<*>}
     */
    async rollback(connectType) {
        if (this[connectType]) {
            return this.provider.rollback(this[connectType]);
        }
        return Promise.resolve();
    }

    /**
     * Разорвать указанное соединеие
     * @param {string} connectType - тип соединения checkConnect|adminConnect
     * @returns {Promise<void>}
     */
    async releaseConnect(connectType) {
        if (this[connectType]) {
            this.provider.releaseConnect(this[connectType]);
        }
    }

    /**
     * Проверка наличия объекта поддержки инструмента
     * @async
     * @param {string} objectType - тип объекта поддержки инструмента
     * @param {string} objectName - имя
     * @param {string} objectSchema - схема
     * @param {string} connectType - тип соединения с бд (проверочный,админский)
     * @returns {Promise<boolean>}
     */
    async existsSpecObj(objectType, objectName, objectSchema = 'public', connectType = 'checkConnect') {
        const typeSql = {
            schema: 'select exists(select $2||null from pg_catalog.pg_namespace where nspname = $1)',
            table: 'select exists(select null from information_schema.tables where table_schema = $2 and table_name = $1)',
            function: 'select exists(select null from information_schema.routines t where t.routine_schema = $2 and t.routine_name = $1)',
            extension: 'select exists(select $2||null from pg_catalog.pg_extension t where t.extname = $1)'
        };
        const resCheck = await this.query(typeSql[objectType], [objectName, objectSchema], connectType);
        return resCheck.rows[0].exists;
    }

    /**
     * Создание или модификация объекта поддержки инструмента
     * @async
     * @param {string} objectName - имя объекта поддержки инструмента
     * @param {string} objectType - тип
     * @returns {Promise<*>}
     */
    async modSpecObj(objectType, objectName) {
        const obj = new NFMigObj(this, {
            file: join(this.dbsrcDirectory, objectType, `${objectName}.sql`),
            name: objectName,
            schema: 'public',
            type: objectType,
        });
        let script;
        if (objectType === 'table') {
            const scriptObj = await obj.getDiff();
            const { safedrop = [], main = [], end = [], pkey = [] } = scriptObj;
            script = safedrop.concat(main, pkey, end).join('\n');
            script = `${script}\ngrant select on public.${objectName} to ${this.checkCredentials.user};`;
        } else if (objectType === 'function') {
            const exists = await this.existsSpecObj(objectType, objectName);
            if (exists) {
                const scriptObj = await obj.getDiff();
                const { safedrop = [], main = [], func = [] } = scriptObj;
                script = safedrop.concat(main, func).join('\n');
            } else {
                script = await obj.getSrcObj();
                const fIdent = extractFunctionIdentity(script);
                script = `${script}\n grant execute on function public.${objectName}(${fIdent}) to ${this.checkCredentials.user};`;
            }
        }
        return this.query(script, null, 'adminConnect');
    }

    async getMigDbData(connectType = 'checkConnect') {
        if (!this.migDbData) {
            const res = await this.query(
                'select filename from public.nf_migrations',
                null,
                connectType,
            );
            this.migDbData = res.rows;
        }
        return this.migDbData;
    }

    async getObjDbData(connectType = 'checkConnect') {
        if (!this.objDbData) {
            const res = await this.query(
                'select * from public.nf_objects',
                null,
                connectType,
            );
            this.objDbData = res.rows;
        }
        return this.objDbData;
    }

    findMigDb(name) {
        return this.migDbData && this.migDbData.find(m => m.filename === name);
    }

    findObjDb(type, schema, name) {
        return this.objDbData && this.objDbData.find(o => (o.obj_name === name
            && o.obj_schema === schema
            && o.obj_type === type));
    }

    async markMigApplied(filename) {
        return this.query(
            'insert into public.nf_migrations (filename) values ($1);',
            [filename],
            'adminConnect'
        );
    }

    async saveObjHash(objInfo, hash) {
        return this.query(
            'insert into public.nf_objects (obj_type, obj_schema, obj_name, hash) values ($1,$2,$3,$4)\n'
            + 'on conflict (obj_type, obj_schema, obj_name) \n'
            + 'do update set hash = $4',
            [objInfo.type, objInfo.schema, objInfo.name, hash],
            'adminConnect'
        );
    }

    async grantAll() {
        let grantAllFunction = common.getPath(config, '@nfjs/migrate.grantAllFunction') || 'nfc.f_db8grant_all';
        const argv = common.getPath(api, 'argv');
        if ('migrate-grant-all-function' in argv) grantAllFunction = argv['migrate-grant-all-function'];
        const exists = await this.existsSpecObj('function', grantAllFunction.split('.')[1], grantAllFunction.split('.')[0], 'adminConnect');
        if (exists) {
            return this.query(`select ${grantAllFunction}()`, undefined, 'adminConnect');
        }
        console.log(`Не найдена функция [${grantAllFunction}] для назначения прав на объекты после обновления.`);
        return Promise.resolve();
    }

    async dbfwNeedInit() {
        const existsOrgTable = await this.existsSpecObj('table', 'org', 'nfc', 'adminConnect');
        const existsUsersTable = await this.existsSpecObj('table', 'users', 'nfc', 'adminConnect');
        const existsInitFunc = await this.existsSpecObj('function', 'f_init', 'nfc', 'adminConnect');
        if (existsOrgTable && existsUsersTable && existsInitFunc) {
            const existsUsersRes = await this.query('select exists (select null from nfc.users) ', undefined, 'adminConnect');
            const existsUsers = existsUsersRes.rows[0].exists;
            const existsOrgRes = await this.query('select exists (select null from nfc.org) ', undefined, 'adminConnect');
            const existsOrg = existsOrgRes.rows[0].exists;
            return !(existsUsers && existsOrg);
        }
        return false;
    }

    async dbfwInit(appAdminName, appAdminPass, appAdminRole) {
        const exists = await this.existsSpecObj('function', 'f_init', 'nfc', 'adminConnect');
        if (exists) {
            return this.query('select nfc.f_init($1,$2,$3)', [appAdminName, appAdminPass, appAdminRole], 'adminConnect');
        }
        return Promise.resolve();
    }

    getCreateSchema(schema) {
        return `create schema if not exists ${schema} authorization ${this.adminCredentials.user};`;
    }

    getCreateExtension(extension) {
        return `create extension if not exists ${extension} with cascade;`;
    }
}

class NFMigBlock {
    constructor(init) {
        const { blIndex, migName, event = {}, script } = init;
        const { when, objName, objType, event: blEvent, initial } = event;
        this.blIndex = blIndex;
        this.migName = migName;
        this.event = blEvent;
        this.when = when;
        this.objName = objName;
        this.objType = objType;
        this.initial = 'no';
        if (initial === 'yes' || initial === 'only') {
            this.initial = initial;
        }
        this.script = script;
        this.applied = false;
    }

    cmpEvent(needEvent) {
        const {
            event, when, objName, objType
        } = needEvent;
        return this.event === event && this.when === when && this.objName === objName && this.objType === objType;
    }

    markApplied() {
        this.applied = true;
    }
}

class NFMig {
    constructor(migFile) {
        this.file = migFile.file;
        this.name = migFile.name;
    }

    getInfo() {
        return {
            name: this.name,
            file: this.file,
            ...this.info,
        };
    }

    async getSrc() {
        this.src = await readFile(this.file, 'utf8');
        return this.src;
    }

    getBlocks() {
        const blocks = this.src.split('--[block]');
        this.blocks = blocks.filter(l => l !== '').map((b, bIndex) => {
            const lines = b.split('\n');
            const bl = { blIndex: bIndex, migName: this.name };
            try {
                bl.event = JSON.parse(lines[0]);
                bl.script = lines.splice(1).join('\n');
            } catch (e) {
                bl.script = b;
            }
            return new NFMigBlock(bl);
        });
        return this.blocks;
    }

    static async createName(schema, count = 0, comment = '') {
        const leftPad = value => (value < 10 ? '0' : '') + value;
        const rnd = await random(4);
        const d = new Date();
        const yyyy = d.getFullYear();
        const MM = leftPad(d.getMonth() + 1);
        const dd = leftPad(d.getDate());
        const HH = leftPad(d.getHours());
        const mm = leftPad(d.getMinutes());
        const ss = leftPad(d.getSeconds());
        const Z = d.toISOString().match(/\.(.*)/)[1];
        const cmnt = comment ? `~${comment}` : '';
        return `${yyyy}-${MM}-${dd}-T-${HH}-${mm}-${ss}-${Z}~${count}~${rnd}~${schema}${cmnt}.sql`;
    }

    static async saveToFile(name, content) {
        const ext = extension.getSortedExtensions();
        const parsed = NFMig._parseName(name);
        const module = await getSchemaModules(parsed.schema);
        const modulePath = ext.find(e => e.name === module).dirname;
        let dateDir = name.split('-');
        dateDir = `${dateDir[0]}-${dateDir[1]}`;
        const saveDir = join(modulePath, 'dbsrc', parsed.schema, 'mig', dateDir);
        try {
            await mkdir(saveDir, { recursive: true });
        } catch (e) {
            if (!e.code === 'EEXIST') throw (e);
        }
        return writeFile(join(saveDir, name), content);
    }

    static _parseName(str) {
        let d = str.replace(/\.sql$/, '');
        d = d.split('~');
        const datePattern = /^(\d{4})-(\d{2})-(\d{2})-T-(\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/;
        const m = d[0].match(datePattern);
        return {
            date: new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}`),
            count: d[1],
            random: d[2],
            schema: d[3],
            comment: d[4],
        };
    }
}

/**
 * Экземпляр соотвествует каждому файлу исходников объектов бд
 */
class NFMigObj {
    constructor(db, objFromFile) {
        this.db = db;
        this.name = objFromFile.name;
        this.type = objFromFile.type;
        this.schema = objFromFile.schema;
        this.fullname = `${this.schema}.${this.name}`;
        this.file = objFromFile.file;
        this.src = objFromFile.src;
        this.srcHash = objFromFile.srcHash;
        this.needSaveHash = false;
    }

    /**
     * Получение исходника по имени из текущей базы данных. Дополнительно вычисляется хеш
     * @returns {Promise<string|Object>}
     */
    async getDbObj() {
        if (!this.dbObj) {
            const getRes = await this.db.query(
                'select public.nf_get_objsrc($1, $2, $3) as obj',
                [this.type, this.schema, this.name],
                'adminConnect'
            );
            this.dbObj = getRes.rows[0].obj;
            this.dbHash = (this.dbObj) ? NFMigObj.getHash(NFMigObj.getTextFromDbObj(this.type, this.dbObj)) : '';
        }
        return this.dbObj;
    }

    /**
     * Получение исходника из файла и подготовка к сравнению
     * @returns {Promise<string|Object>}
     */
    async getSrcObj() {
        if (!this.src) this.src = await NFMigObj.getSrc(this.file);
        if (!this.srcHash) this.srcHash = await NFMigObj.getHash(this.src);
        if (this.type === 'table' || this.type === 'sequence') {
            this.srcObj = JSON.parse(this.src);
            if (this.type === 'table' && this.srcObj.cols && this.srcObj.cols.length > 0) {
                // чтобы колонки при создании были отсортированы как в оригинале, а не по имени, как хранится в файле
                this.srcObj.cols.sort((a1, a2) => {
                    const { column_id: n1 } = a1;
                    const { column_id: n2 } = a2;
                    if (n1 < n2) return -1;
                    if (n1 > n2) return 1;
                    return 0;
                });
            }
        } else {
            this.srcObj = this.src;
        }
        return this.srcObj;
    }

    /**
     * Получение хеша исходника из файла
     * @returns {Promise<string>}
     */
    async getSrcHash() {
        if (!this.srcHash) await this.getSrcObj();
        return this.srcHash;
    }

    /**
     * Получение содержимого файла исходник
     * @static
     * @param filename
     * @returns {Promise<*>}
     */
    static async getSrc(filename) {
        return readFile(filename, 'utf8');
    }

    /**
     * Получения списка зависимых от текущего объекта. Реализация есть только для dependedType = view, trigger
     * @param {string} dependentType - тип зависимого объекта
     * @param {Array<string>} [columns = undefined] - массив имён колонок, если текущий объект - таблица
     * @returns {Promise<Array<Object>>}
     */
    async getDependent(dependentType, columns) {
        let sql;
        let _refclassid = 'pg_class';
        let _refobjclass = 'regclass';
        switch (this.type) {
            case ('function'): {
                _refclassid = 'pg_proc';
                _refobjclass = 'regproc';
                break;
            }
        }
        switch (dependentType) {
            case 'view':
                sql = `select distinct
                              v.oid::regclass as fullname,
                              'view' as type,
                              v.relnamespace::regnamespace as schema,
                              v.relname as name
                    from pg_catalog.pg_depend as d -- objects that depend
                         ${(columns !== undefined) ? `join pg_catalog.pg_attribute as a on (d.refobjsubid = a.attnum and d.refobjid = a.attrelid and a.attname = any($1))`:''}
                         join pg_catalog.pg_rewrite as r on r.oid = d.objid -- rules depending
                         join pg_catalog.pg_class as v on v.oid = r.ev_class -- views for the rules
                    where v.relkind = 'v'
                      and d.classid = 'pg_rewrite'::regclass
                      and d.deptype = 'n'
                      ${(this.type === 'view') ? 'and v.oid != d.refobjid' : ''}
                      and d.refclassid = '${_refclassid}'::regclass
                      and d.refobjid = '${this.fullname}'::${_refobjclass}`;
                break;
            case 'trigger':
                sql = `select distinct
                          c.relnamespace::regnamespace||'.'||t.tgname as fullname,
                          'trigger' as type,
                          c.relnamespace::regnamespace as schema,
                          t.tgname as name
                    from pg_catalog.pg_depend as d -- objects that depend
                         join pg_catalog.pg_trigger t on t.oid = d.objid
                         join pg_catalog.pg_class c on c.oid = t.tgrelid
                    where d.classid = 'pg_trigger'::regclass
                      and d.deptype = 'n'
                      and d.refclassid = '${_refclassid}'::regclass
                      and d.refobjid = '${this.fullname}'::${_refobjclass}`;
                break;
            default:
                break;
        }
        const prm = (columns) ? [columns] : [];
        const sqlRes = await this.db.query(sql,prm,'adminConnect');
        return sqlRes.rows || [];
    }

    /**
     *
     */
    setNeedOnlyRecreate(){
        this.needOnlyRecreate = true;
    }
    /**
     * Сравнение подготовленных объектов или строк исходников. На выходе объект с массивами
     * @param {boolean} [force=false] Признак что нужно перепрогнать вычисление diff
     * @returns {Promise<Object>}
     */
    async getDiff(force = false) {
        if (this.diff && !force) return this.diff;
        if (!this.dbObj) await this.getDbObj();
        let diffObj = {};
        // когда нужно только пересоздать объект по исходникам из бд. Применяется когда по зависимостям требуется
        if (this.needOnlyRecreate === true) {
            switch (this.type) {
                case 'view':
                    diffObj = {
                        view: [this.dbObj.src],
                        safedrop: [this.getDropScript()]
                    };
                    const _viewDep = await this.getDependent('view');
                    if (_viewDep.length > 0)
                        this.pushDependent(_viewDep);
                    break;
                case 'trigger':
                    diffObj = {
                        trig: [this.dbObj.src],
                        safedrop: [this.getDropScript()]
                    };
                    break;
                default:
                    break;
            }
        } else {
            if (!this.srcObj) await this.getSrcObj();
            // dbHash был вычислен в getDbObj, а srcHash в getSrcObj
            if (this.dbHash !== this.srcHash) {
                switch (this.type) {
                    case 'table':
                        diffObj = DboTable.diff(this.srcObj, this.dbObj, { checkObjName });
                        if ('colChangeDatatype' in diffObj && Array.isArray(diffObj.colChangeDatatype)) {
                            const _viewDep = await this.getDependent('view', diffObj.colChangeDatatype);
                            if (_viewDep.length > 0) {
                                diffObj.needdrop = _viewDep;
                                this.pushDependent(diffObj.needdrop);
                            }
                        }
                        break;
                    case 'sequence':
                        const [schema, name] = this.fullname.split('.');
                        diffObj = DboSequence.diff(Object.assign(this.srcObj, {schema, name}), this.dbObj);
                        break;
                    case 'function':
                        diffObj = {func: [this.src]};
                        if (this.dbObj && this.dbObj.identity_arguments !== undefined) {
                            const fIdent = extractFunctionIdentity(this.src);
                            const srcReturns = extractFunctionReturns(this.src);
                            const dbReturns = extractFunctionReturns(this.dbObj.src);
                            // не добавляем удаление функции, если параметры остались те же
                            if (this.dbObj.identity_arguments !== fIdent || srcReturns !== dbReturns) {
                                diffObj.safedrop = [this.getDropScript()];
                                const _viewDep = await this.getDependent('view');
                                const _trigDep = await this.getDependent('trigger');
                                if (_viewDep.length > 0 || _trigDep.length > 0) {
                                    diffObj.needdrop = [..._trigDep,..._viewDep];
                                    this.pushDependent(diffObj.needdrop);
                                }
                            }
                        }
                        break;
                    case 'view':
                        diffObj = {view: [this.src]};
                        if (this.dbObj && this.dbObj.src) {
                            diffObj.safedrop = [this.getDropScript()];
                            const _viewDep = await this.getDependent('view');
                            if (_viewDep.length > 0) {
                                diffObj.needdrop = _viewDep;
                                this.pushDependent(diffObj.needdrop);
                            }
                        }
                        break;
                    case 'trigger':
                        diffObj = {trig: [this.src]};
                        if (this.dbObj && this.dbObj.src) {
                            diffObj.safedrop = [this.getDropScript()];
                        }
                        break;
                    default:
                        break;
                }
            }
            const {
                main, safedrop, end, unsafedrop, func, view, trig
            } = diffObj;
            if ((main && main.length > 0)
                || (safedrop && safedrop.length > 0)
                || (end && end.length > 0)
                || (unsafedrop && unsafedrop.length > 0)
                || (func && func.length > 0)
                || (view && view.length > 0)
                || (trig && trig.length > 0)) {
                this.needSaveHash = true;
            }
        }
        this.diff = diffObj;
        return diffObj;
    }
    getDiffObj() {
        if (!this.diff) throw new Error(`Скрипт изменения объекта [${this.getTextName()}] не был еще подготовлен.`);
        return this.diff;
    }
    getDropScript() {
        if (!this.dbObj) throw new Error(`Для генерации скрипта удаления в объекте [${this.getTextName()}] должен быть загруженходник из базы данных.`);
        let script;
        switch (this.type) {
            case 'function':
                script = dropFunction(this.fullname, this.dbObj.identity_arguments);
                break;
            case 'view':
                script = dropView(this.fullname);
                break;
            case 'trigger':
                script = dropTrigger(this.fullname, undefined, this.dbObj.src);
                break;
            default:
                break;
        }
        return script;
    }

    pushDependent(dependent) {
        if (dependent) {
            if (!this.dependent) this.dependent = [];
            this.dependent.push(...dependent);
        }
    }
    /**
     * Сохранить хеш исходника в бд
     * @returns {Promise<*>}
     */
    async saveHash() {
        return this.db.saveObjHash({ type: this.type, schema: this.schema, name: this.name }, this.srcHash);
    }

    static getHash(text) {
        return getHash(text.replace(/(\r\n|\n|\r)/gm," ").trim());
    }

    static getTextFromDbObj(objectType, obj) {
        let textObj;
        switch (objectType) {
            case 'table':
                if (obj && obj.cols && obj.cols.length > 0) sortArrayByName(obj.cols);
                if (obj && obj.cons && obj.cons.length > 0) sortArrayByName(obj.cons);
                if (obj && obj.indx && obj.indx.length > 0) sortArrayByName(obj.indx);
                textObj = JSON.stringify(obj, null, 4);
                break;
            case 'sequence':
                textObj = JSON.stringify(obj, null, 4);
                break;
            default:
                textObj = obj.src;
                break;
        }
        return textObj;
    }

    static async saveToFile(module, schema, objectName, objectType, content) {
        const ext = extension.getExtensions(module);
        let saveDir = ext.dirname;
        saveDir = join(saveDir, 'dbsrc', schema, 'src', objectType);
        try {
            await mkdir(saveDir, { recursive: true });
        } catch (e) {
            if (e.code !== 'EEXIST') throw (e);
        }
        return writeFile(join(saveDir, `${objectName}.sql`), content);
    }

    getTextName() {
        return `${this.type} ${this.fullname}`;
    }
}

/**
 * Экземпляром является информация о файле данных dataFile, выгруженных с помощью схемы eSchFile
 * и загружаемом по схеме iSchFile
 */
class NFMigDat {
    /**
     * Инициализация по найленному поиском по паттерну всех файлов данных
     * @param {Object} datFromFile
     */
    constructor(datFromFile) {
        const { iSchFile, eSchFile, dataFile, schema, table, eCommon } = datFromFile;
        this.iSchFile = iSchFile;
        this.eSchFile = eSchFile;
        this.dataFile = dataFile;
        this.schema = schema;
        this.table = table;
        this.eCommon = eCommon;
    }

    /**
     * Вычисление хеша для сравнения при проверке необходимости обновления и для сохранения в бд после.
     * Прочтенный исходник не сохраняется в this, потому что считывание потом будет отдельным механизмом
     * @returns {Promise<string>}
     */
    async getSrcHash() {
        const src = await readFile(this.dataFile, 'utf8');
        this.srcHash = await getHash(src);
        return this.srcHash;
    }

    /**
     * Получение массива готовых к выполнению sql с параметрами по каждой записи из файла данных
     * @returns {Promise<Array>}
     */
    async getScripts() {
        const schema = JSON.parse(
            await readFile(this.iSchFile)
        );
        const inStream = createReadStream(this.dataFile);
        const extractor = new NFExtract(schema, inStream);
        const loader = new NFLoad(schema, { objectMode: true });
        const cArr = new NFcomposeArr();
        const finish = new Promise((resolve, reject) => {
            cArr.on('finish', () => resolve(cArr.arr));
            cArr.on('error', err => reject(err));
        });
        extractor.pipe(loader).pipe(cArr);
        extractor.export();
        try {
            const res = await finish;
        } catch (e) {
            throw (e);
        }
        this.scripts = cArr.arr;
        return this.scripts;
    }
}

export {
    NFMigDb,
    NFMig,
    NFMigObj,
    NFMigDat,
};
