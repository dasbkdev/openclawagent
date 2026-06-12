select column_name,data_type
from information_schema.columns
where table_name='workflow_entity'
order by ordinal_position;
