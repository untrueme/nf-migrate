import fg from "fast-glob";
import { NFMigDat } from "./migration.js";
import { exists, readFile } from "./utils.js";
import { join, basename, dirname } from 'path';

/**
 * Найти все файлы миграции приложения
 * @param {Object} [schemas=undefined] - схемы базы данных и модули, в которых они содержат исходники {"nfc":"@nfjs/back-dbfw"}
 * @param {boolean} [sorted=false] - признак необходимости сортировки по имени файла миграции
 * @returns {Promise<Object[]>}
 */
async function getAllMigrationFiles(schemas = undefined, sorted = false) {
    const modulesRoot = join(process.cwd(), 'node_modules').replace(/\\/g, '/');
    let dirMigPattern = '*/**/dbsrc/*/mig/*/**.sql';
    if (schemas) {
        // dirMigPattern = `+(${Object.values(schemas).join('|')})/dbsrc/*/mig/*/**.sql`;
        dirMigPattern = `*/**/dbsrc/+(${Object.keys(schemas).join('|')})/mig/*/**.sql`;
    }
    let files = await fg(
        dirMigPattern,
        { cwd: modulesRoot, onlyFiles: true },
    );
    if (sorted) {
        files = (files || [])
            .sort((f1, f2) => {
                const n1 = basename(f1);
                const n2 = basename(f2);

                if (n1 < n2) return -1;
                if (n1 > n2) return 1;
                return 0;
            });
    }
    return files.map(f => ({
        file: join(modulesRoot, f),
        name: basename(f, '.sql'),
    }));
}

/**
 * Найти все файлы объектов базы данных приложения
 * @param {Object} [schemas] - схемы базы данных и модули, в которых они содержат исходники {"nfc":"@nfjs/back-dbfw"}
 * @returns {Promise<Object[]>}
 */
async function getAllObjFiles(schemas) {
    const modulesRoot = join(process.cwd(), 'node_modules').replace(/\\/g, '/');
    let dirObjPattern = '*/**/dbsrc/*/src/*/**.sql';
    if (schemas) {
        dirObjPattern = `*/**/dbsrc/+(${Object.keys(schemas).join('|')})/src/*/**.sql`;
    }
    const files = await fg(
        dirObjPattern,
        { cwd: modulesRoot, onlyFiles: true },
    );
    return files.map(f => ({
        name: basename(f, '.sql'),
        type: basename(dirname(f)),
        schema: basename(dirname(dirname(dirname(f)))),
        file: join(modulesRoot, f)
    }));
}

/**
 * Найти все файлы данных со схемами экмпорта\импорта приложения
 * @param {Object} [schemas] - схемы базы данных и модули, в которых они содержат исходники {"nfc":"@nfjs/back-dbfw"}
 * @returns {Promise<Object[]>}
 */
async function getAllDatFiles(schemas = undefined) {
    const modulesRoot = join(process.cwd(), 'node_modules');
    let dirDatPattern = '*/**/dbsrc/*/dat/*';
    if (schemas) {
        dirDatPattern = `*/**/dbsrc/+(${Object.keys(schemas).join('|')})/dat/*`;
    }
    const files = await fg(
        dirDatPattern,
        { cwd: modulesRoot, onlyDirectories: true },
    );
    const res = [];
    for (const df of files) {
        const schema = basename(dirname(dirname(df)));
        const table = basename(df);
        const dataFile = join(modulesRoot, df, 'data.json');
        let iSchFile = join(modulesRoot, df, 'iSch.json');
        let eSchFile = join(modulesRoot, df, 'eSch.json');
        let eCommon = false;
        const iSchExists = await exists(iSchFile);
        if (!iSchExists) {
            iSchFile = join(modulesRoot, '@nfjs', 'migrate', 'data_schemas', table, 'iSch.json');
        }
        const eSchExists = await exists(eSchFile);
        if (!eSchExists) {
            eSchFile = join(modulesRoot, '@nfjs', 'migrate', 'data_schemas', table, 'eSch.json');
            eCommon = true;
        }
        res.push(new NFMigDat({
            iSchFile,
            eSchFile,
            dataFile,
            schema,
            table,
            eCommon
        }));
    }
    return res;
}

/**
 * Найти все файлы системных объектов\настроек бд
 * @param {Object} [schemas] - схемы базы данных и модули, в которых они содержат исходники {"nfc":"@nfjs/back-dbfw"}
 * @returns {Object[]}
 */
async function getAllSysFiles(schemas = undefined) {
    const modulesRoot = join(process.cwd(), 'node_modules').replace(/\\/g, '/');
    let dirDatPattern = '*/**/dbsrc/*/sys.json';
    if (schemas) {
        dirDatPattern = `*/**/dbsrc/+(${Object.keys(schemas).join('|')})/sys.json`;
    }
    const files = await fg(
        dirDatPattern,
        { cwd: modulesRoot, onlyFiles: true },
    );
    const res = {
        extensions: []
    };
    for (const df of files) {
        const _f = await readFile(join(modulesRoot, df), 'utf8');
        const f = JSON.parse(_f);
        if ('extensions' in f) res.extensions.push(...f.extensions);
    }
    res.extensions = [...new Set(res.extensions)];
    return res;
}
export {
    getAllMigrationFiles,
    getAllObjFiles,
    getAllDatFiles,
    getAllSysFiles
}