# Challenges and Soliutions

## Challenge 1: Manual skills triggering is cumbersome

The original flow given by you dictates the usage of 4 different skills: ADR-skill, Datasource-skill, OpenSpec, and Superpower, each to be used for a specific purpose (as we discussed). However manually triggering a separate Skill for each step of the task and having to tell the agent to only use the specific skill for the specific purpose (i.e. not use OpenSpec for implementation, don't use Superpowers for planning, don't use ADR for low-level code changes) every time is time consuming, token consuming, and can result in instances where the flow we want to follow isn't followed properly.

Solution: I create a new Skill called `agentic-feature-lifecycle`, which basically handles the orchestration of the other skills that are part of the suggested workflow, based on the task at hand. It documents flows for:

- New project/feature creation: Makes sure that when a user is starting with creating a new project/feature, the agent first determines all architectural decision from the user using `superpowers:brainstorming`, then translates those decisions to ADR, then translates ADR to OpenSpecs, then creates new, seperate Git branch for each spec, then implement code changes to those specific spec branches via Superpowers, and finally creates an MR for the spec with main so that the implementations can be reviewed.
- Bug fixes: If a user wants to fix a bug, the agent identifies the correct feature branch to target in order to fix the bug (or create a new branch if no relevant feature branch exists), then the agent using brainstorming with the user decides if the bug fix introduces any ADR level changes, then it decides if the bug fix introduces and spec level changes, and then the agent actually implements the spec level changes to fix the bug and commits them.
- Old project transitioning to the new Agentic flow: If you want to make your old project compatible with the ADR and spec based flow, the agent can actually do that by identifying all architectural decisions within your project's files and then creates ADR docs based on that, it then identifies all implemented specs inside the project and creates OpenSpecs for them. As they are already implemented, there are no spec branches or MRs created. This is purely a documentational flow.

## Challenge 2: Agentic skills eat up tokens like nobodys business, even when it is not really needed

While the agentic workflow is good for developing applications carefully and documenting everything, In my experience with Github Copilot coding agent GPT-5.3-Codex, I went from around 40% of my premium tokens left to 0% left over the course of developing a relatively simple tool. This is not ideal, and in my opinion, I think this workflow is better reserved for bigger level tasks where architectural preservation and decision-making is important, and not for tasks which involve rapid prototyping or the creation of a small tool/POC product.

However I can see the utility in documenting the architecture of POC/prototype products as well, hence I feel like a slightly tweaked version of this workflow might be good for such development tasks where we use the ADR skill + AGENTS.md file to have the agent automatically update the architecture docs when necessary, but the actual development/testing is done using rapid appraoches which involve direct coding and/or direct human-to-agent instructions. This is like a reverse flow where instead of starting with architecture and ending with development we start with development and end on architecture? This is just a thought though, and for bigger projects I think this flow is pretty good to ensure that
    a. No breaking changes are made on main etc.
    b. Architectural decisions are our source of truth
    c. Big projects are broken down into smaller spec level pieces to improve the quality of implementation.

I feel like the agentic-feature-lifecycle skill good be further improved, or a seperate skill introduced for that to increase the speed of bug fixing and to ensure that lesser tokens are required for that. For my specific project, the agent was able to implement features pretty reliably, with the "bugs" mainly occuring either due to my stupidity during testing or due to the usage of smaller more incompetent models amid decreasing usage limits.

## Challenge 3: Sometimes the agent triggers wrong skill

I experienced a scenario where the agent trigerred the Superpower skill for spec creation rather than using OpenSpec.

Solution: I tightened AGENTS.md and the agentic-feature-lifecycle skill to make sure this does not happen.
