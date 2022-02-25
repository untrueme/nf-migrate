{
    "schema": "public",
    "tablename": "nf_objects",
    "comment": null,
    "cols": [
        {
            "name": "hash",
            "datatype": "varchar",
            "datatype_length": "64",
            "datatype_full": "character varying(64)",
            "required": true,
            "default_value": null,
            "comment": null,
            "fk_tablename": null,
            "column_id": 4
        },
        {
            "name": "obj_name",
            "datatype": "varchar",
            "datatype_length": "255",
            "datatype_full": "character varying(255)",
            "required": true,
            "default_value": null,
            "comment": null,
            "fk_tablename": null,
            "column_id": 3
        },
        {
            "name": "obj_schema",
            "datatype": "varchar",
            "datatype_length": "255",
            "datatype_full": "character varying(255)",
            "required": true,
            "default_value": null,
            "comment": null,
            "fk_tablename": null,
            "column_id": 2
        },
        {
            "name": "obj_type",
            "datatype": "varchar",
            "datatype_length": "30",
            "datatype_full": "character varying(30)",
            "required": true,
            "default_value": null,
            "comment": null,
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
            "comment": null,
            "fk_tablename": null,
            "column_id": 5
        }
    ],
    "cons": [
        {
            "name": "pk4nf_objects",
            "schema": "public",
            "type": "p",
            "update_rule": null,
            "delete_rule": null,
            "condition": null,
            "definition": "PRIMARY KEY (obj_type, obj_schema, obj_name)",
            "r_schema": null,
            "r_tablename": null,
            "r_columnname": null,
            "columns": "obj_type,obj_schema,obj_name",
            "comment": null,
            "deferrable": null
        }
    ],
    "indx": null
}