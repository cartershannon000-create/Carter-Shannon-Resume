-- Venmo had to appear in fin.account_roles to carry amount_negative_for_spend, but the
-- table's only roles were 'cash' and 'card', so it was filed as cash. That is wrong and
-- it silently moved money: fin.cashflow() walks the checking balance over role='cash',
-- and Python's CASH_ACCOUNT is Checking ALONE. Every Venmo transaction was being folded
-- into the derived bank balance, putting 2026-07 closing out by $1,880.36.
--
-- Sign-flipping and balance-stock membership are different questions about an account.
-- 'other' keeps them separate: Venmo still flips sign, still counts as deferred spend
-- (anything not 'cash'), and is still excluded from card float (only 'card').
alter table fin.account_roles drop constraint if exists account_roles_role_check;
alter table fin.account_roles add constraint account_roles_role_check
  check (role in ('cash', 'card', 'other'));

update fin.account_roles set role = 'other' where account = 'Venmo';;
