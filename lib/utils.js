import { readFile as _readFile, writeFile as _writeFile, mkdir as _mkdir, stat } from 'fs';
import { promisify } from 'util';
import crypto from 'crypto';
import fg from 'fast-glob';

import { join, basename, dirname } from 'path';
import { extension } from '@nfjs/core';

const readFile = promisify(_readFile);
const writeFile = promisify(_writeFile);
const mkdir = promisify(_mkdir);

/**
 * Проверка файла на существование по абсолютному пути
 * @async
 * @param {string} file - абсолютный путь до файла
 * @returns {Promise<boolean>}
 */
async function exists(file) {
    return new Promise((resolve, reject) => {
        stat(file, (err, files) => {
            if (err === null) {
                resolve(true);
                return;
            }
            const { code } = err;
            if (code === 'ENOENT') {
                resolve(false);
                return;
            }
            reject(err);
        });
    });
}

async function random(size) {
    return new Promise((resolve, reject) => {
        crypto.pseudoRandomBytes(size, (err, raw) => (err === null ? resolve(raw.toString('hex')) : reject(err)));
    });
}

/**
 * Найти все используемые в приложении схемы базы данных с исходниками
 * @async
 * @param {string} [schema=undefined] - схема базы данных, если нужно вернуть информацию по одной конкретной
 * @param {boolean} [filterByExt=false] - фильтровать по подключенным в момент выполнения модулям приложения
 * @returns {Object|string} - объект {"nfc":"@nfjs/back-dbfw"} или строка '@nfjs/back-dbfw', если schema был указан
 */
async function getSchemaModules(schema = undefined, filterByExt = false) {
    const schPaths = {};
    const dirPattern = '*/**/dbsrc/*';
    const schemaDirs = await fg(dirPattern, {
        cwd: join(process.cwd(), 'node_modules').replace(/\\/g, '/'),
        onlyDirectories: true
    });
    const exts = extension.getSortedExtensions();
    schemaDirs.forEach((pt) => {
        const sch = basename(pt);
        const mdl = dirname(dirname(pt));
        let inc = true;
        if (filterByExt) {
            inc = exts.some(e => e.name === mdl);
        }
        if (inc) schPaths[sch] = mdl;
    });
    if (schema) {
        return schPaths[schema];
    } else {
        return schPaths;
    }
}

/**
 * Хеширование строки
 * @param {string} string - хешируемая строка
 * @returns {string}
 */
function getHash(string) {
    return crypto.createHash('md5').update(string).digest('hex');
}

/**
 * Сортировка массива однотипных объектов, предположительно содержащих свойство name
 * @param {Object[]} arr - сортируемый массив
 */
function sortArrayByName(arr) {
    arr.sort((a1, a2) => {
        const { name: n1 } = a1;
        const { name: n2 } = a2;
        if (n1 < n2) return -1;
        if (n1 > n2) return 1;
        return 0;
    });
}

function sortDependent(objs) {
    const res = []; //Empty list that will contain the sorted nodes
    while (objs.findIndex(o => !('_markP' in o)) !== -1) {//exists nodes without a permanent mark do
        const n = objs.find(o => !('_markP' in o));  // select an unmarked node n
        visit(n);
    }
    function visit(n) {
        if (n._markP) //if n has a permanent mark then return
            return;
        if (n._markT) // if n has a temporary mark then stop(not a DAG)
            throw new Error(`Обнаружена циклическая зависимость у объекта [${n.getTextName}].`);
        n._markT = true;  // mark n with a temporary mark
        // for each node m with an edge from n to m do visit(m)
        for (let i = 0; i < (n.dependent || []).length; i++) {
            const m = objs.find(o => o.type === n.dependent[i].type && o.fullname === n.dependent[i].fullname);
            if (m) visit(m);
        }
        delete n._markT; // remove temporary mark from n
        n._markP = true; // mark n with a permanent mark
        res.push(n); // add n to head of res
    }
    // clear marks
    for (let i = 0; i < objs.length; i++) {
        delete objs[i]._markP;
        delete objs[i]._markT;
    }
    return res;
}

function extractFunctionIdentity(functionSource) {
    // сработает только если в одну строку весь заголовок функции в исходниках
    const insideBracketsMatch = functionSource.match(/\((.*)\)/);
    const insideBrackets = ((insideBracketsMatch) ? insideBracketsMatch[1] : '');
    const clearTexts = insideBrackets.replace(/\'[^\']*\'/g,'');
    const clearAnotherBrackets = clearTexts.replace(/\(.*?\)/gi,'');
    const clearDefault = clearAnotherBrackets.replace(/ default[^,]*/gi, '');
    return clearDefault;
}

function extractFunctionReturns(functionSource) {
    const tableType = functionSource.match(/\sreturns\s+table\s*\((.*)\)\s/i);
    if (tableType) return `table(${tableType[1]})`;
    const ret = functionSource.match(/\sreturns\s+([^\s]*)\s/i);
    return ret[1].toLowerCase();
}

export function extractTableNameFromTrigger(triggerSource, addSchema = false) {
    // CREATE CONSTRAINT TRIGGER tr4int_mis8checks_deferred AFTER INSERT OR UPDATE ON admin.int_mis DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE PROCEDURE admin.f4int_mis8tr_checks_deferred();
    const tableMatch = triggerSource.match(/\s+on\s+(\w+\.\w+)/i);
    return (addSchema) ? tableMatch[1] : tableMatch[1].split('.')[1];
}

export function extractTableName(objName) {
    let oName = objName;
    if (oName.indexOf('.') !== -1) oName = oName.split('.')[1];
    oName = oName.substring(oName.indexOf('4')+1);
    const postfix = oName.lastIndexOf('8');
    oName = (postfix === -1) ? oName : oName.substring(0, postfix);
    return oName;
}

function checkObjName(objName, tableName) {
    const [prefix, ...other] = objName.split('4');
    if (!prefix || prefix === objName) return false;
    const postfix = other.join('4').replace(tableName,'');
    return !((postfix !== '' && postfix.indexOf('8') !== 0) || postfix.length === 1);
}

function dropTrigger(trigfullName, trigTableName, trigSource) {
    let tableName;
    if (trigTableName) {
        tableName = (trigTableName.indexOf('.') === -1) ? trigTableName : trigTableName.split('.')[1];
    } else {
        if (trigSource) {
            tableName = extractTableNameFromTrigger(trigSource)
        } else {
            tableName = extractTableName(trigfullName);
        }
    }
    const [schema, triggerName] = trigfullName.split('.');
    return `drop trigger if exists ${triggerName} on ${schema}.${tableName};`;
}

function dropFunction(funcName, funcArguments) {
    return `drop function if exists ${funcName}(${(funcArguments) || ''});`;
}

function dropView(viewName) {
    return `drop view if exists ${viewName};`;
}

export {
    exists,
    readFile,
    writeFile,
    mkdir,
    random,
    getHash,
    getSchemaModules,
    sortArrayByName,
    sortDependent,
    extractFunctionIdentity,
    extractFunctionReturns,
    checkObjName,
    dropTrigger,
    dropFunction,
    dropView
};
