{
    "schema": "public",
    "tablename": "nf_migrations",
    "comment": null,
    "cols": [
        {
            "name": "filename",
            "datatype": "varchar",
            "datatype_length": "255",
            "datatype_full": "character varying(255)",
            "required": true,
            "default_value": null,
            "comment": "Имя файла миграции",
            "fk_tablename": null,
            "column_id": 1
        },
        {
            "name": "ts",
            "datatype": "timestamptz",
            "datatype_length": null,
            "datatype_full": "timestamp with time zone",
            "required": true,
            "default_value": "clock_timestamp()",
            "comment": "Время выполнения",
            "fk_tablename": null,
            "column_id": 2
        }
    ],
    "cons": [
        {
            "name": "pk4nf_migrate",
            "schema": "public",
            "type": "p",
            "update_rule": null,
            "delete_rule": null,
            "condition": null,
            "definition": "PRIMARY KEY (filename)",
            "r_schema": null,
            "r_tablename": null,
            "r_columnname": null,
            "columns": "filename",
            "comment": null,
            "deferrable": null
        }
    ],
    "indx": null
}