import * as apiJs from './lib/api.js';
import {api, common, config} from "@nfjs/core";

const meta = {
    require: {
        after: [
            '@nfjs/back', '@nfjs/db-postgres']
    }
};

async function init() {
    // проверить необходимость проводить обновление бд
    const consoleMigrate = common.getPath(api, 'argv.domigrate');
    if (consoleMigrate && ['y', 'Y', true, 'true', 't'].indexOf(consoleMigrate) !== -1) {
        await apiJs.checkAndRun(true);
    } else {
        const doMigrate = common.getPath(config, '@nfjs/migrate.doMigrate');
        if (doMigrate) await apiJs.checkAndRun(false);
    }
}

export {
    meta,
    init
};
