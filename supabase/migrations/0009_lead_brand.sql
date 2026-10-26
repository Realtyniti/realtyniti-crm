-- Chetan runs ads under more than one name (Realtyniti, Tathya Homes).
-- Each lead remembers which one it enquired with, and messages greet it in that name.
alter table leads add column brand text not null default 'Realtyniti';

-- Templates name the brand through {{brand}} instead of hard-coding Realtyniti.
-- None were approved yet; editing a body withdraws approval anyway.
update message_templates
set body = replace(replace(body, 'from Realtyniti', 'from {{brand}}'), 'reaching out to Realtyniti', 'reaching out to {{brand}}')
where body like '%Realtyniti%';
