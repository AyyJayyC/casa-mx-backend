import json, os, subprocess, sys
from openhands.sdk import LLM, Conversation, get_logger
from openhands.tools.preset.default import get_default_agent

logger = get_logger(__name__)

def get_issue(repo, issue_number):
    result = subprocess.run(
        ["gh", "api", f"repos/{repo}/issues/{issue_number}"],
        capture_output=True, text=True, env={**os.environ, "GH_TOKEN": os.environ["GH_TOKEN"]}
    )
    issue = json.loads(result.stdout)
    body = issue.get("body", "")
    title = issue.get("title", "")
    return f"# {title}\n\n{body}"

def create_pr(repo, issue_number, branch_name):
    result = subprocess.run(
        ["gh", "pr", "create",
         "--repo", repo,
         "--base", os.environ.get("TARGET_BRANCH", "main"),
         "--head", branch_name,
         "--title", f"Fix #{issue_number}",
         "--body", f"Automated fix for issue #{issue_number}"],
        capture_output=True, text=True,
        env={**os.environ, "GH_TOKEN": os.environ["GH_TOKEN"]}
    )
    return result.stdout

def main():
    issue_number = sys.argv[1]
    repo = os.environ["GITHUB_REPOSITORY"]
    prompt = get_issue(repo, issue_number)

    llm = LLM(
        model=os.environ["LLM_MODEL"],
        api_key=os.environ["LLM_API_KEY"],
        base_url=os.environ.get("LLM_BASE_URL") or None,
        usage_id="issue-resolver",
        drop_params=True,
    )
    agent = get_default_agent(llm=llm, cli_mode=True)
    cwd = os.getcwd()

    branch_name = f"openhands-fix-{issue_number}"
    subprocess.run(["git", "checkout", "-b", branch_name], check=True)

    conversation = Conversation(agent=agent, workspace=cwd)
    conversation.send_message(prompt)
    conversation.run()

    subprocess.run(["git", "add", "-A"], check=True)
    diff = subprocess.run(["git", "diff", "--cached"], capture_output=True, text=True)
    if diff.stdout.strip():
        subprocess.run(["git", "commit", "-m", f"Fix #{issue_number}"], check=True)
        subprocess.run(["git", "push", "origin", branch_name], check=True)
        pr_url = create_pr(repo, issue_number, branch_name)
        logger.info(f"PR created: {pr_url}")
    else:
        logger.info("No changes to commit")

if __name__ == "__main__":
    main()
