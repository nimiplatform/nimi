import emailValidator from 'email-validator';

// Preserve the existing actions-dco policy: merges and GitHub-identified bots
// are exempt; a sign-off must match an author/committer name and email.
export function dcoFailures(commits) {
  const failures = [];
  for (const entry of commits) {
    if (entry.parents?.length > 1 || entry.author?.type === 'Bot') continue;
    const { author, committer, message } = entry.commit;
    const names = [author.name, committer.name].map((value) => value.toLowerCase());
    const emails = [author.email, committer.email].map((value) => value.toLowerCase());
    const signoffs = [...message.matchAll(/^Signed-off-by: (.*) <(.*)>$/gim)];
    let reason;
    if (signoffs.length === 0) reason = 'Signed-off-by is missing';
    else if (!emailValidator.validate(author.email || committer.email)) reason = 'author email is invalid';
    else if (!signoffs.some(([, name, email]) => names.includes(name.toLowerCase()) && emails.includes(email.toLowerCase()))) {
      reason = 'Signed-off-by does not match the author or committer';
    }
    if (reason) failures.push({ sha: entry.sha, reason });
  }
  return failures;
}
