/* StatChasers Depth Charts — front-end renderer.
   Reads the locally cached JSON (data-endpoint) and renders the depth-chart UI:
   Fantasy / Offense / Defense / Special Teams tabs, search, team + position
   filters, and a responsive grid that packs more teams per row as columns shrink.
   Renders only from the cached file in /uploads; no external calls. */
(function () {
	"use strict";

	// `key` is the JSON positions[] key; `slug` is the clean URL segment. The
	// Fantasy tab reads its dedicated FAN_* columns but keeps simple
	// position slugs (qb/rb/…) in the URL.
	var TABS = {
		fantasy: {
			label: "Fantasy",
			columns: [
				{ key: "FAN_QB", slug: "qb", label: "Quarterbacks", short: "QB" },
				{ key: "FAN_RB", slug: "rb", label: "Running Backs", short: "RB" },
				{ key: "FAN_WR", slug: "wr", label: "Wide Receivers", short: "WR" },
				{ key: "FAN_TE", slug: "te", label: "Tight Ends", short: "TE" },
				{ key: "FAN_K", slug: "k", label: "Kickers", short: "K" }
			]
		},
		offense: {
			label: "Offense",
			columns: [
				{ key: "QB", slug: "qb", label: "QB" },
				{ key: "RB", slug: "rb", label: "RB" },
				{ key: "WR", slug: "wr", label: "WR" },
				{ key: "TE", slug: "te", label: "TE" },
				{ key: "LT", slug: "lt", label: "LT" },
				{ key: "LG", slug: "lg", label: "LG" },
				{ key: "C", slug: "c", label: "C" },
				{ key: "RG", slug: "rg", label: "RG" },
				{ key: "RT", slug: "rt", label: "RT" }
			]
		},
		defense: {
			label: "Defense",
			columns: [
				{ key: "EDGE", slug: "edge", label: "EDGE" },
				{ key: "DL", slug: "dl", label: "DL" },
				{ key: "LB", slug: "lb", label: "LB" },
				{ key: "CB", slug: "cb", label: "CB" },
				{ key: "S", slug: "s", label: "S" }
			]
		},
		special: {
			label: "Special Teams",
			columns: [
				{ key: "K", slug: "k", label: "K" },
				{ key: "P", slug: "p", label: "P" },
				{ key: "LS", slug: "ls", label: "LS" },
				{ key: "KR", slug: "kr", label: "KR" },
				{ key: "PR", slug: "pr", label: "PR" }
			]
		}
	};
	var TAB_ORDER = ["fantasy", "offense", "defense", "special"];
	var COLUMN_WIDTH_REM = 11;

	// Color-coded position abbreviations in the search dropdown. Keyed by the base
	// position code (col.short || col.label || col.key); unlisted positions render
	// in a neutral gray.
	var POSITION_COLOR = {
		QB: "#dc2626", // red
		RB: "#16a34a", // green
		WR: "#2563eb", // blue
		TE: "#ca8a04", // yellow
		K: "#9333ea" // purple
	};

	// Normalize a player name for cross-position matching: lowercase, drop periods
	// and generational suffixes, collapse whitespace.
	function normNameKey(name) {
		var words = String(name)
			.toLowerCase()
			.replace(/[.']/g, "")
			.replace(/[^a-z0-9]+/g, " ")
			.trim()
			.split(/\s+/);
		var suffixes = { jr: 1, sr: 1, ii: 1, iii: 1, iv: 1, v: 1 };
		while (words.length > 1 && suffixes[words[words.length - 1]]) words.pop();
		return words.join(" ");
	}

	// Pretty-URL view slugs <-> internal tab keys.
	var VIEW_TO_SLUG = {
		fantasy: "fantasy",
		offense: "offense",
		defense: "defense",
		special: "special-teams"
	};
	var SLUG_TO_VIEW = {
		fantasy: "fantasy",
		offense: "offense",
		defense: "defense",
		"special-teams": "special"
	};

	// "Buffalo Bills" -> "buffalo-bills"; "San Francisco 49ers" -> "san-francisco-49ers".
	function slugify(value) {
		return String(value)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	// Read a JSON data-attribute, falling back to `fallback` on anything unexpected.
	function jsonAttr(node, name, fallback) {
		var raw = node.getAttribute(name);
		if (!raw) return fallback;
		try {
			var parsed = JSON.parse(raw);
			return parsed && typeof parsed === "object" ? parsed : fallback;
		} catch (e) {
			return fallback;
		}
	}

	// Image props with the opt-outs the common lazy-load plugins honour. These
	// images are created after page load, and several optimizers still swap their
	// src for a placeholder that never resolves inside a popover that was never
	// "scrolled into view" — leaving an empty box where the logo should be.
	// "eager" is deliberate for the small dropdown imagery.
	function imgProps(props) {
		var out = { "data-no-lazy": "1", "data-skip-lazy": "1", decoding: "async" };
		Object.keys(props).forEach(function (k) {
			out[k] = props[k];
		});
		out.class = (out.class ? out.class + " " : "") + "skip-lazy";
		return out;
	}

	// Tiny DOM helper. props.text sets textContent (safe); props.class sets className.
	function el(tag, props, children) {
		var node = document.createElement(tag);
		if (props) {
			Object.keys(props).forEach(function (k) {
				if (k === "class") {
					node.className = props[k];
				} else if (k === "text") {
					node.textContent = props[k];
				} else if (k === "html") {
					node.innerHTML = props[k];
				} else {
					node.setAttribute(k, props[k]);
				}
			});
		}
		(children || []).forEach(function (c) {
			if (c == null) return;
			node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
		});
		return node;
	}

	// A select that can show imagery. Native <option> elements render as OS
	// widgets and cannot contain an <img> or per-option colour, so the team and
	// position filters use this instead — same behaviour as a <select> (value,
	// change event, keyboard), but each row can carry a team logo or a coloured
	// position code, matching the rows in the search dropdown.
	function customSelect(config) {
		var options = [];
		var value = null;
		var open = false;
		var activeIndex = -1;

		var valueEl = el("span", { class: "scdc-cs-value" });
		var trigger = el("button", {
			type: "button",
			class: "scdc-cs-trigger",
			"aria-haspopup": "listbox",
			"aria-expanded": "false"
		}, [valueEl]);
		var caret = el("span", { class: "scdc-cs-caret", "aria-hidden": "true" });
		caret.innerHTML =
			'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
		trigger.appendChild(caret);

		var list = el("div", { class: "scdc-cs-list", role: "listbox" });
		var root = el("div", { class: "scdc-cs" }, [trigger, list]);
		if (config && config.label) trigger.setAttribute("aria-label", config.label);

		function optionByValue(v) {
			for (var i = 0; i < options.length; i++) {
				if (options[i].value === v) return options[i];
			}
			return null;
		}

		// Row content: optional logo (or abbreviation placeholder), the label, and
		// an optional colour-coded position code.
		function fillRow(node, opt) {
			node.innerHTML = "";
			if (opt.logo) {
				node.appendChild(el("img", imgProps({ class: "scdc-cs-logo", src: opt.logo, alt: "" })));
			} else if (opt.abbr) {
				node.appendChild(el("span", { class: "scdc-cs-logo scdc-cs-logo-text", text: opt.abbr }));
			}
			node.appendChild(el("span", { class: "scdc-cs-label", text: opt.label }));
			if (opt.badge) {
				var badge = el("span", { class: "scdc-cs-badge", text: opt.badge });
				if (opt.badgeColor) badge.style.color = opt.badgeColor;
				node.appendChild(badge);
			}
		}

		function renderTrigger() {
			var opt = optionByValue(value) || options[0];
			if (opt) fillRow(valueEl, opt);
		}

		function renderList() {
			list.innerHTML = "";
			options.forEach(function (opt, i) {
				var row = el("div", {
					class: "scdc-cs-option" + (opt.value === value ? " is-selected" : ""),
					role: "option",
					"aria-selected": opt.value === value ? "true" : "false"
				});
				fillRow(row, opt);
				// mousedown, so the choice registers before the trigger loses focus.
				row.addEventListener("mousedown", function (e) {
					e.preventDefault();
					choose(i);
				});
				row.addEventListener("mouseenter", function () {
					setActive(i);
				});
				list.appendChild(row);
			});
		}

		function setActive(i) {
			activeIndex = i;
			Array.prototype.forEach.call(list.children, function (c, idx) {
				c.classList.toggle("is-active", idx === i);
			});
			if (list.children[i] && list.children[i].scrollIntoView) {
				list.children[i].scrollIntoView({ block: "nearest" });
			}
		}

		function openList() {
			if (open) return;
			open = true;
			root.classList.add("is-open");
			trigger.setAttribute("aria-expanded", "true");
			renderList();
			var current = options.map(function (o) { return o.value; }).indexOf(value);
			setActive(current < 0 ? 0 : current);
		}

		function closeList() {
			if (!open) return;
			open = false;
			root.classList.remove("is-open");
			trigger.setAttribute("aria-expanded", "false");
			activeIndex = -1;
		}

		function choose(i) {
			var opt = options[i];
			if (!opt) return;
			value = opt.value;
			renderTrigger();
			closeList();
			trigger.focus();
			if (config && config.onChange) config.onChange(value);
		}

		trigger.addEventListener("click", function () {
			if (open) closeList(); else openList();
		});
		trigger.addEventListener("keydown", function (e) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				if (!open) { openList(); return; }
				var next = e.key === "ArrowDown" ? activeIndex + 1 : activeIndex - 1;
				setActive(Math.max(0, Math.min(options.length - 1, next)));
			} else if (e.key === "Enter" || e.key === " ") {
				if (open) { e.preventDefault(); choose(activeIndex); }
			} else if (e.key === "Escape") {
				closeList();
			} else if (e.key === "Home" && open) {
				e.preventDefault(); setActive(0);
			} else if (e.key === "End" && open) {
				e.preventDefault(); setActive(options.length - 1);
			}
		});
		trigger.addEventListener("blur", function () {
			// Delay, so a click landing inside the list still resolves first.
			setTimeout(closeList, 120);
		});
		document.addEventListener("mousedown", function (e) {
			if (open && !root.contains(e.target)) closeList();
		});

		return {
			el: root,
			setOptions: function (next) {
				options = next || [];
				if (!optionByValue(value) && options.length) value = options[0].value;
				renderTrigger();
				if (open) renderList();
			},
			setValue: function (v) {
				if (v === value) return;
				value = v;
				renderTrigger();
				if (open) renderList();
			},
			getValue: function () { return value; }
		};
	}

	function getPlayers(team, key) {
		return (team.positions && team.positions[key]) || [];
	}

	// Tab-aware search match: a team is a hit when its name/abbr contains the
	// query, OR one of its players *in the currently displayed columns* does.
	// Scoping to `columns` (rather than every raw position key) means a Fantasy-tab
	// search only surfaces teams whose match is actually visible on that tab.
	function teamMatchesSearch(team, q, columns) {
		if (!q) return true;
		q = q.toLowerCase();
		if (
			team.team.name.toLowerCase().indexOf(q) !== -1 ||
			team.team.abbr.toLowerCase().indexOf(q) !== -1
		) {
			return true;
		}
		for (var i = 0; i < columns.length; i++) {
			var players = getPlayers(team, columns[i].key);
			for (var j = 0; j < players.length; j++) {
				if (players[j].name && players[j].name.toLowerCase().indexOf(q) !== -1) {
					return true;
				}
			}
		}
		return false;
	}

	var STATUS_BADGE = {
		Q: { label: "Q", cls: "scdc-badge-warn" },
		D: { label: "D", cls: "scdc-badge-warn" },
		O: { label: "O", cls: "scdc-badge-out" },
		IR: { label: "IR", cls: "scdc-badge-out" },
		PUP: { label: "PUP", cls: "scdc-badge-out" },
		SUSP: { label: "SUS", cls: "scdc-badge-out" },
		SUS: { label: "SUS", cls: "scdc-badge-out" }
	};

	// "Josh Sweat" -> "J. Sweat". Keeps everything after the first name intact
	// so suffixes/compound surnames survive (e.g. "Amon-Ra St. Brown").
	function abbreviateName(name) {
		var firstSpace = name.indexOf(" ");
		if (firstSpace <= 0) return name;
		return name.charAt(0) + ". " + name.slice(firstSpace + 1);
	}

	function playerRow(player) {
		var children = [];

		if (player.movement === "up") {
			children.push(el("span", { class: "scdc-move scdc-move-up", text: "▲", title: "Moved up" }));
		} else if (player.movement === "down") {
			children.push(el("span", { class: "scdc-move scdc-move-down", text: "▼", title: "Moved down" }));
		}

		// Zero-padded depth rank ("01", "02") for a calm, aligned tabular column.
		var rankText = String(player.rank);
		if (rankText.length < 2) rankText = "0" + rankText;
		children.push(el("span", { class: "scdc-rank", text: rankText }));
		// Full name by default; CSS swaps to the abbreviated form when the
		// column is squeezed to its narrowest (scrolling) width.
		children.push(el("span", { class: "scdc-name scdc-name-full", text: player.name }));
		children.push(el("span", { class: "scdc-name scdc-name-abbr", text: abbreviateName(player.name) }));

		var badges = [];
		if (player.movement === "new") {
			badges.push(el("span", { class: "scdc-badge scdc-badge-new", text: "NEW" }));
		}
		if (player.status) {
			var known = STATUS_BADGE[String(player.status).toUpperCase()];
			if (known) {
				badges.push(el("span", { class: "scdc-badge " + known.cls, text: known.label }));
			} else {
				badges.push(el("span", { class: "scdc-badge scdc-badge-out", text: player.status }));
			}
		}
		if (badges.length) {
			children.push(el("span", { class: "scdc-badges" }, badges));
		}

		return el("div", { class: "scdc-player" }, children);
	}

	function positionColumn(label, players, short) {
		var body;
		if (!players.length) {
			body = el("div", { class: "scdc-col-body" }, [el("div", { class: "scdc-col-empty", text: "—" })]);
		} else {
			body = el("div", { class: "scdc-col-body" }, players.map(playerRow));
		}
		// Editorial header: an uppercase eyebrow (full label by default; CSS swaps
		// to the compact form e.g. "QB" once the column is squeezed) plus a quiet
		// count badge, then a hairline rule with a short gold micro-accent.
		var headChildren = [
			el("span", { class: "scdc-colhead-text" }, [
				el("span", { class: "scdc-colhead-full", text: label }),
				el("span", { class: "scdc-colhead-abbr", text: short || label })
			])
		];
		if (players.length) {
			headChildren.push(el("span", { class: "scdc-col-count", text: String(players.length) }));
		}
		var head = el("div", { class: "scdc-col-head" }, headChildren);
		var rule = el("div", { class: "scdc-col-rule" });
		return el("div", { class: "scdc-col" }, [head, rule, body]);
	}

	// Watches a card's horizontally-scrollable column strip and toggles --sc-fit
	// on it: 1 while everything fits, 0.8 once the columns overflow and would
	// otherwise need horizontal scrolling (shrinking column widths + padding
	// ~20%). Hysteresis on the restore side keeps the shrink — which itself
	// reduces scrollWidth — from oscillating the state.
	function attachFit(colsEl, innerEl) {
		if (typeof ResizeObserver === "undefined") return;
		var fit = 1;
		function measure() {
			var overflow = colsEl.scrollWidth - colsEl.clientWidth;
			var next = fit === 1 ? (overflow > 0 ? 0.8 : 1) : (overflow > -24 ? 0.8 : 1);
			if (next !== fit) {
				fit = next;
				colsEl.style.setProperty("--sc-fit", String(fit));
			}
		}
		var ro = new ResizeObserver(measure);
		ro.observe(colsEl);
		ro.observe(innerEl);
	}

	function teamCard(team, columns, template) {
		var logo;
		if (team.team.logo) {
			logo = el("img", imgProps({ src: team.team.logo, alt: team.team.name + " logo", loading: "lazy" }));
		} else {
			logo = el("span", { text: team.team.abbr });
		}

		var inner = el(
			"div",
			{ class: "scdc-cols-inner" },
			columns.map(function (col) {
				return positionColumn(col.label, getPlayers(team, col.key), col.short);
			})
		);
		// Per-position auto-fit widths (computed once from all teams). Uniform on
		// wide screens, narrowing each position to its own width as space runs out.
		inner.style.gridTemplateColumns = template;

		// Small summary strip, e.g. "3 QB · 6 RB · 4 WR · 2 TE · 1 K".
		var summary = columns
			.map(function (col) {
				return { label: col.short || col.label, n: getPlayers(team, col.key).length };
			})
			.filter(function (x) { return x.n > 0; })
			.map(function (x) { return x.n + " " + x.label; })
			.join(" · ");

		var cols = el("div", { class: "scdc-cols" }, [inner]);
		attachFit(cols, inner);

		return el("div", { class: "scdc-team-card" }, [
			el("div", { class: "scdc-team-head" }, [
				el("div", { class: "scdc-logo" }, [logo]),
				el("div", { class: "scdc-team-title" }, [
					el("span", { class: "scdc-team-name", text: team.team.name }),
					summary ? el("div", { class: "scdc-team-summary", text: summary }) : null
				])
			]),
			cols
		]);
	}

	function cardMinWidth(colCount) {
		// + team-surface horizontal padding (~1.15rem each side).
		var rem = colCount * COLUMN_WIDTH_REM + (colCount - 1) * 0.5 + 2.3;
		return "min(100%, " + rem.toFixed(2) + "rem)";
	}

	function render(root, data, ctx) {
		var teams = (data.teams || []).slice().sort(function (a, b) {
			return a.team.name.localeCompare(b.team.name);
		});

		// Bidirectional team <-> slug maps built from the loaded data.
		var abbrToSlug = {};
		var slugToAbbr = {};
		teams.forEach(function (t) {
			var s = slugify(t.team.name);
			abbrToSlug[t.team.abbr] = s;
			slugToAbbr[s] = t.team.abbr;
		});

		// The server's 32-team config wins: routes, canonicals and links are built
		// from it in PHP, so the client uses the same slugs rather than re-deriving.
		Object.keys(ctx.teams || {}).forEach(function (abbr) {
			var slug = ctx.teams[abbr] && ctx.teams[abbr].s;
			if (!slug) return;
			abbrToSlug[abbr] = slug;
			slugToAbbr[slug] = abbr;
		});

		var state = { search: "", team: "ALL", position: "ALL", tab: "fantasy" };

		// Per-position "auto-fit" width (rem): wide enough for that position's
		// longest (abbreviated) name across every team, so a given position is the
		// SAME width in all teams. Cached per position key.
		var fitCache = {};
		function positionFitRem(colKey, shortLabel) {
			if (fitCache[colKey] != null) return fitCache[colKey];
			var maxChars = (shortLabel || "").length;
			teams.forEach(function (t) {
				getPlayers(t, colKey).forEach(function (p) {
					var len = abbreviateName(p.name).length;
					if (len > maxChars) maxChars = len;
				});
			});
			// ~0.4rem/char at the tight 0.7rem font, plus gutters; clamped so no
			// column is absurdly narrow or wider than the uniform 6rem max.
			var rem = Math.min(6, Math.max(3.5, Math.round((maxChars * 0.4 + 1) * 100) / 100));
			fitCache[colKey] = rem;
			return rem;
		}
		// Per-column grid template for the currently displayed columns: uniform
		// 6rem min on wide screens (grows via 1fr), tightening toward each
		// position's own fit as the viewport shrinks. Same vw term for all so they
		// narrow together; the per-column min is what differentiates.
		function columnTemplate(columns) {
			return columns
				.map(function (col) {
					// Each track's min is scaled by --sc-fit (set per card by
					// attachFit): 1 normally, 0.8 when the columns overflow — shrinking
					// columns (and their padding) up to 20% to pack more onto the screen.
					return (
						"minmax(calc(clamp(" +
						positionFitRem(col.key, col.short || col.label) +
						"rem, calc(0.6rem + 9.6vw), 6rem) * var(--sc-fit, 1)), 1fr)"
					);
				})
				.join(" ");
		}

		// ---- Pretty-URL helpers --------------------------------------------
		function teamSlugFor(abbr) {
			if (abbr === "ALL") return "all-teams";
			return abbrToSlug[abbr] || "all-teams";
		}
		function positionSlugFor(pos) {
			if (pos === "ALL") return "";
			var cols = TABS[state.tab].columns;
			for (var i = 0; i < cols.length; i++) {
				if (cols[i].key === pos) return cols[i].slug;
			}
			return "";
		}
		function buildUrl() {
			var url = ctx.basePath + VIEW_TO_SLUG[state.tab] + "/";
			var teamSlug = teamSlugFor(state.team);
			var ps = positionSlugFor(state.position);
			// "all-teams" is only needed as a placeholder when a position follows it;
			// otherwise /{view}/ is the canonical general URL the server advertises.
			if (teamSlug !== "all-teams" || ps) url += teamSlug + "/";
			if (ps) url += ps + "/";
			return url;
		}
		// Resolve raw URL slugs into a validated state, with safe fallbacks (#11).
		function resolveSlugs(slugs) {
			var tab = SLUG_TO_VIEW[slugs.view] || "fantasy";

			var team = "ALL";
			if (slugs.team && slugs.team !== "all-teams") {
				team = slugToAbbr[slugs.team] || "ALL";
			}

			var position = "ALL";
			if (slugs.position && slugs.position !== "all") {
				var want = slugs.position.toLowerCase();
				TABS[tab].columns.forEach(function (c) {
					if (c.slug === want) position = c.key;
				});
			}
			return { tab: tab, team: team, position: position };
		}
		// Read the current location into raw slugs relative to the base path.
		function parsePath() {
			var path = window.location.pathname;
			var base = ctx.basePath;
			var rest = "";
			if (path.indexOf(base) === 0) {
				rest = path.slice(base.length);
			} else {
				var bareBase = base.replace(/\/$/, "");
				if (path.indexOf(bareBase) === 0) {
					rest = path.slice(bareBase.length).replace(/^\//, "");
				}
			}
			var segs = rest.split("/").filter(Boolean);
			return { view: segs[0] || "", team: segs[1] || "", position: segs[2] || "" };
		}

		root.innerHTML = "";

		// ---- Controls ----
		var controls = el("div", { class: "scdc-controls" });

		var search = el("input", {
			type: "text",
			class: "scdc-input",
			placeholder: "Search team or player...",
			autocomplete: "off",
			role: "combobox",
			"aria-expanded": "false",
			"aria-autocomplete": "list"
		});
		// Autocomplete dropdown: teams + players for the active tab, alphabetical.
		var suggestBox = el("div", { class: "scdc-suggest", role: "listbox" });
		var searchWrap = el("div", { class: "scdc-search-wrap" }, [search, suggestBox]);

		var suggestItems = []; // full list for the current tab
		var suggestShown = []; // currently rendered (query-filtered) subset
		var suggestActive = -1; // highlighted index in suggestShown
		var suggestTab = null; // tab the list was last built for

		// Index headshots by normalized name across *every* position (built once),
		// so a tab whose source lacks headshots (e.g. Fantasy's FAN_* columns) can
		// still borrow a player's ESPN headshot found elsewhere.
		var headshotIndex = null;
		function getHeadshotIndex() {
			if (headshotIndex) return headshotIndex;
			headshotIndex = {};
			teams.forEach(function (t) {
				var positions = t.positions || {};
				Object.keys(positions).forEach(function (key) {
					positions[key].forEach(function (p) {
						if (p.headshot && p.name) {
							var nk = normNameKey(p.name);
							if (!headshotIndex[nk]) headshotIndex[nk] = p.headshot;
						}
					});
				});
			});
			return headshotIndex;
		}

		// Build the alphabetical team + player list for the active tab. Players are
		// de-duplicated by name and drawn only from the tab's visible columns. Each
		// row carries its imagery: teams a logo; players a headshot + their team's
		// abbr/logo, plus the position code.
		function buildSuggestions() {
			var cols = TABS[state.tab].columns;
			var heads = getHeadshotIndex();
			var items = [];
			teams.forEach(function (t) {
				items.push({ type: "team", label: t.team.name, sub: t.team.abbr, logo: t.team.logo });
			});
			var seen = {};
			teams.forEach(function (t) {
				cols.forEach(function (col) {
					var code = col.short || col.label || col.key;
					getPlayers(t, col.key).forEach(function (p) {
						if (!p.name) return;
						var k = p.name.toLowerCase();
						if (seen[k]) return;
						seen[k] = true;
						items.push({
							type: "player",
							label: p.name,
							sub: t.team.abbr,
							pos: code,
							headshot: p.headshot || heads[normNameKey(p.name)] || null,
							teamLogo: t.team.logo
						});
					});
				});
			});
			items.sort(function (a, b) {
				return a.label.toLowerCase().localeCompare(b.label.toLowerCase());
			});
			suggestItems = items;
			suggestTab = state.tab;
		}

		function ensureSuggestions() {
			if (suggestTab !== state.tab) buildSuggestions();
		}

		function setActive(i) {
			suggestActive = i;
			Array.prototype.forEach.call(suggestBox.children, function (c, idx) {
				c.className = idx === i ? "scdc-suggest-item is-active" : "scdc-suggest-item";
			});
			var item = suggestBox.children[i];
			if (item && item.scrollIntoView) item.scrollIntoView({ block: "nearest" });
		}

		function closeSuggest() {
			suggestBox.style.display = "none";
			suggestBox.innerHTML = "";
			suggestActive = -1;
			search.setAttribute("aria-expanded", "false");
		}

		function selectSuggestion(it) {
			search.value = it.label;
			state.search = it.label;
			closeSuggest();
			draw();
		}

		// Row imagery: a team logo for team rows; a player headshot with a small
		// team-logo badge for player rows. Missing images fall back to the team
		// abbreviation. Logos render on transparent backgrounds.
		function suggestAvatar(it) {
			if (it.type === "team") {
				var teamWrap = el("span", { class: "scdc-sg-avatar scdc-sg-avatar-team" });
				if (it.logo) {
					teamWrap.appendChild(el("img", imgProps({ class: "scdc-sg-logo", src: it.logo, alt: "" })));
				} else {
					teamWrap.appendChild(el("span", { class: "scdc-sg-fallback", text: it.sub || "" }));
				}
				return teamWrap;
			}
			var wrap = el("span", { class: "scdc-sg-avatar" });
			if (it.headshot) {
				wrap.appendChild(el("img", imgProps({ class: "scdc-sg-head", src: it.headshot, alt: "" })));
				if (it.teamLogo) {
					wrap.appendChild(el("img", imgProps({ class: "scdc-sg-badge", src: it.teamLogo, alt: "" })));
				}
			} else if (it.teamLogo) {
				// No headshot for this player (ESPN doesn't publish one, or the cached
				// file predates them). Show the team logo at full size rather than an
				// orphaned corner badge floating beside the abbreviation.
				wrap.appendChild(el("img", imgProps({ class: "scdc-sg-logo", src: it.teamLogo, alt: "" })));
			} else {
				wrap.appendChild(el("span", { class: "scdc-sg-fallback", text: it.sub || "" }));
			}
			return wrap;
		}

		// Render the dropdown filtered by the current input; capped so a full
		// player roster can't build thousands of DOM nodes at once.
		function openSuggest() {
			ensureSuggestions();
			var q = search.value.trim().toLowerCase();
			var list = q
				? suggestItems.filter(function (it) {
						return it.label.toLowerCase().indexOf(q) !== -1;
				  })
				: suggestItems;
			suggestShown = list.slice(0, 60);
			suggestActive = -1;
			suggestBox.innerHTML = "";
			if (!suggestShown.length) {
				closeSuggest();
				return;
			}
			suggestShown.forEach(function (it, i) {
				// Name, with the color-coded position code to its right (players only).
				var main = el("span", { class: "scdc-suggest-main" }, [
					el("span", { class: "scdc-suggest-label", text: it.label })
				]);
				if (it.type === "player" && it.pos) {
					var posEl = el("span", { class: "scdc-suggest-pos", text: it.pos });
					posEl.style.color = POSITION_COLOR[it.pos] || "#64748b";
					// Inline, so the code can't be squeezed to nothing beside the
					// nowrap label if the stylesheet is ever stripped or overridden.
					posEl.style.flex = "0 0 auto";
					main.appendChild(posEl);
				}
				var left = el("span", { class: "scdc-suggest-left" }, [suggestAvatar(it), main]);
				var right = el("span", {
					class: "scdc-suggest-type",
					text: it.type === "team" ? "Team" : it.sub || "Player"
				});
				var row = el("div", { class: "scdc-suggest-item", role: "option" }, [left, right]);
				// mousedown (not click) so the selection fires before the input's blur.
				row.addEventListener("mousedown", function (e) {
					e.preventDefault();
					selectSuggestion(it);
				});
				row.addEventListener("mouseenter", function () {
					setActive(i);
				});
				suggestBox.appendChild(row);
			});
			suggestBox.style.display = "block";
			search.setAttribute("aria-expanded", "true");
		}

		search.addEventListener("input", function () {
			state.search = search.value;
			openSuggest();
			draw();
		});
		search.addEventListener("focus", openSuggest);
		search.addEventListener("click", openSuggest);
		search.addEventListener("blur", function () {
			// Small delay so a click inside the list still resolves first.
			setTimeout(closeSuggest, 120);
		});
		search.addEventListener("keydown", function (e) {
			var open = suggestBox.style.display !== "none" && suggestShown.length;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				if (!open) { openSuggest(); return; }
				setActive(Math.min(suggestActive + 1, suggestShown.length - 1));
			} else if (e.key === "ArrowUp") {
				if (!open) return;
				e.preventDefault();
				setActive(Math.max(suggestActive - 1, 0));
			} else if (e.key === "Enter") {
				if (open && suggestActive >= 0 && suggestShown[suggestActive]) {
					e.preventDefault();
					selectSuggestion(suggestShown[suggestActive]);
				}
			} else if (e.key === "Escape") {
				closeSuggest();
			}
		});

		var posSelect = customSelect({
			label: "Filter by position",
			onChange: function (v) {
				state.position = v;
				commit("push");
			}
		});
		var teamSelect = customSelect({
			label: "Filter by team",
			onChange: function (v) {
				state.team = v;
				commit("push");
			}
		});

		// Team rows carry the franchise logo, exactly like the search dropdown.
		teamSelect.setOptions(
			[{ value: "ALL", label: "All teams" }].concat(
				teams.map(function (t) {
					return {
						value: t.team.abbr,
						label: t.team.name + " (" + t.team.abbr + ")",
						logo: t.team.logo,
						abbr: t.team.logo ? null : t.team.abbr
					};
				})
			)
		);
		teamSelect.setValue("ALL");

		// Export — secondary action, softened so it doesn't compete with the
		// view switch. Exports exactly what's on screen (visible teams ×
		// displayed columns) as an Excel-friendly CSV.
		var downloadBtn = el("button", { type: "button", class: "scdc-download" });
		downloadBtn.innerHTML =
			'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
		downloadBtn.appendChild(document.createTextNode("Export"));
		downloadBtn.addEventListener("click", handleDownload);

		// Row 1: search (grows) + Export beside it. Row 2: the two filters share
		// a row. Keeps the toolbar to two tidy rows instead of auto-stacking.
		var searchRow = el("div", { class: "scdc-controls-row scdc-controls-row-primary" }, [
			el("div", { class: "scdc-field scdc-field-search" }, [searchWrap]),
			el("div", { class: "scdc-field scdc-field-download" }, [downloadBtn])
		]);
		var filterRow = el("div", { class: "scdc-controls-row scdc-controls-row-filters" }, [
			el("div", { class: "scdc-field scdc-field-pos" }, [posSelect.el]),
			el("div", { class: "scdc-field scdc-field-team" }, [teamSelect.el])
		]);

		var tabsEl = el("div", { class: "scdc-tabs" });
		TAB_ORDER.forEach(function (key) {
			var btn = el("button", { type: "button", class: "scdc-tab", text: TABS[key].label });
			btn.addEventListener("click", function () {
				state.tab = key;
				state.position = "ALL"; // positions differ per tab
				// Clear the search: its term is scoped to the tab's columns, so a
				// carried-over query could otherwise leave the new tab looking empty.
				state.search = "";
				search.value = "";
				closeSuggest();
				commit("push");
			});
			btn._key = key;
			tabsEl.appendChild(btn);
		});

		// View switch spans the toolbar width; quiet results count at the far
		// right (populated in draw()).
		var contextEl = el("span", { class: "scdc-context" });
		var viewRow = el("div", { class: "scdc-view scdc-header" }, [tabsEl, contextEl]);

		// View switch first, as a top header band; then the toolbar rows.
		controls.appendChild(viewRow);
		controls.appendChild(searchRow);
		controls.appendChild(filterRow);

		// Soft informational note, shown only while the Fantasy view is active
		// (toggled in draw()).
		var fantasyNote = el("div", { class: "scdc-fantasy-note" });
		fantasyNote.innerHTML =
			'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
		fantasyNote.appendChild(
			document.createTextNode(
				"Fantasy view prioritizes fantasy value and may differ from official team depth charts."
			)
		);
		controls.appendChild(fantasyNote);
		root.appendChild(controls);

		var body = el("div", {});
		root.appendChild(body);

		function syncTabs() {
			Array.prototype.forEach.call(tabsEl.children, function (btn) {
				if (btn._key === state.tab) {
					btn.className = "scdc-tab is-active";
				} else {
					btn.className = "scdc-tab";
				}
			});
		}

		function syncPosOptions() {
			var opts = [{ value: "ALL", label: "All positions" }];
			TABS[state.tab].columns.forEach(function (col) {
				var code = col.short || col.label || col.key;
				opts.push({
					value: col.key,
					label: col.label,
					badge: code,
					badgeColor: POSITION_COLOR[code] || "#64748b"
				});
			});
			posSelect.setOptions(opts);
			posSelect.setValue(state.position);
		}

		// Columns currently displayed (active tab, narrowed by the position filter).
		function currentColumns() {
			var tabColumns = TABS[state.tab].columns;
			return state.position === "ALL"
				? tabColumns
				: tabColumns.filter(function (c) {
						return c.key === state.position;
				  });
		}

		// Teams currently visible (team filter + search). Search is scoped to the
		// active tab's columns so only teams with a *visible* match are kept.
		function currentVisible() {
			var cols = TABS[state.tab].columns;
			return teams.filter(function (t) {
				if (state.team !== "ALL" && t.team.abbr !== state.team) return false;
				return teamMatchesSearch(t, state.search, cols);
			});
		}

		function draw() {
			var columns = currentColumns();
			var visible = currentVisible();

			if (fantasyNote) fantasyNote.style.display = state.tab === "fantasy" ? "" : "none";
			if (downloadBtn) downloadBtn.disabled = !visible.length;

			// Quiet results count (secondary context, muted text). Shown in the
			// header on wider screens; on mobile it's hidden there and rendered
			// directly above the first team card instead (see below).
			var contextText = "";
			var count = 0;
			visible.forEach(function (t) {
				columns.forEach(function (col) {
					count += getPlayers(t, col.key).length;
				});
			});
			contextText = "Showing " + count + " players";
			if (state.position !== "ALL") {
				var posLabel = state.position;
				TABS[state.tab].columns.forEach(function (c) {
					if (c.key === state.position) posLabel = c.label;
				});
				contextText += " · " + posLabel;
			}
			if (state.team !== "ALL") {
				contextText += " · " + state.team;
			}
			if (contextEl) contextEl.textContent = contextText;

			body.innerHTML = "";

			if (!visible.length) {
				body.appendChild(
					el("div", { class: "scdc-empty" }, [el("p", { text: "No teams found. Try adjusting your search or filters." })])
				);
				return;
			}

			var template = columnTemplate(columns);
			var grid = el(
				"div",
				{ class: "scdc-grid" },
				visible.map(function (t) {
					return teamCard(t, columns, template);
				})
			);
			grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(" + cardMinWidth(columns.length) + ", 1fr))";

			// Mobile-only results count, directly above the first team card.
			body.appendChild(el("div", { class: "scdc-context-mobile", text: contextText }));
			body.appendChild(grid);
		}

		// CSV-quote a field if it contains a comma, quote, or newline.
		function csvCell(value) {
			var s = value == null ? "" : String(value);
			if (/[",\n]/.test(s)) {
				s = '"' + s.replace(/"/g, '""') + '"';
			}
			return s;
		}

		// Export the on-screen data (visible teams × displayed columns) as a
		// wide-format CSV: one row per Team + Position, players in depth order
		// spread across Player 1, Player 2, … columns. Opens natively in Excel.
		function handleDownload() {
			var columns = currentColumns();
			var visible = currentVisible();

			var records = [];
			visible.forEach(function (team) {
				columns.forEach(function (col) {
					var players = getPlayers(team, col.key);
					if (players.length) {
						records.push({ team: team, position: col.label, players: players });
					}
				});
			});
			if (!records.length) return;

			var maxPlayers = records.reduce(function (m, r) {
				return Math.max(m, r.players.length);
			}, 0);

			var header = ["Team", "Abbr", "Position"];
			for (var i = 0; i < maxPlayers; i++) header.push("Player " + (i + 1));

			var lines = [header.map(csvCell).join(",")];
			records.forEach(function (r) {
				var cells = [r.team.team.name, r.team.team.abbr, r.position];
				for (var j = 0; j < maxPlayers; j++) {
					var p = r.players[j];
					cells.push(p ? p.name + (p.status ? " (" + p.status + ")" : "") : "");
				}
				lines.push(cells.map(csvCell).join(","));
			});

			// Prepend a BOM so Excel reads UTF-8 names (accents, apostrophes) right.
			var csv = "﻿" + lines.join("\r\n");
			var stamp = new Date().toISOString().slice(0, 10);
			var filename = "statchasers-depth-charts-" + VIEW_TO_SLUG[state.tab] + "-" + stamp + ".csv";

			var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
			var url = URL.createObjectURL(blob);
			var a = el("a", { href: url, download: filename });
			a.style.display = "none";
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}

		// Re-sync the controls to `state`, redraw, and optionally update the URL.
		// mode: "push" (user action), "replace" (canonicalize), or "" (no URL change).
		function commit(mode) {
			syncTabs();
			syncPosOptions();
			teamSelect.setValue(state.team);
			draw();
			syncSeoChrome();
			if (mode === "push" || mode === "replace") {
				var url = buildUrl();
				if (mode === "replace") {
					window.history.replaceState(null, "", url);
				} else if (url !== window.location.pathname) {
					window.history.pushState(null, "", url);
				}
			}
		}

		// Apply a resolved state (from URL/attrs) without recording new history.
		function applyResolved(resolved) {
			state.tab = resolved.tab;
			state.team = resolved.team;
			state.position = resolved.position;
		}

		// ---- Page chrome (H1 / intro / summary / document metadata) ----------
		// The initial HTML already carries the correct, server-generated values for
		// the requested URL — this only keeps them true when a visitor switches
		// teams in-page, so the displayed team, URL, H1 and title never disagree.
		var pageEl = root.parentNode || document.body;
		var initialDocTitle = document.title;
		var initialDocDesc = (function () {
			var node = document.querySelector('meta[name="description"]');
			return node ? node.getAttribute("content") : "";
		})();

		function fillTemplate(tpl, values) {
			var out = String(tpl || "");
			Object.keys(values).forEach(function (key) {
				out = out.split("{" + key + "}").join(values[key]);
			});
			return out;
		}
		function teamMetaFor(abbr) {
			return (ctx.teams && ctx.teams[abbr]) || null;
		}
		function teamRowFor(abbr) {
			for (var i = 0; i < teams.length; i++) {
				if (teams[i].team.abbr === abbr) return teams[i];
			}
			return null;
		}
		function teamPageUrl(abbr) {
			var meta = teamMetaFor(abbr);
			if (!meta) return ctx.mainUrl;
			return window.location.origin + ctx.basePath + "fantasy/" + meta.s + "/";
		}

		// The H1 is server-rendered: either the theme/Divi title (retitled in PHP and
		// tagged data-scdc-h1) or the tool's own. Fall back to recognizing it by text
		// when the visitor landed on the general page, where nothing was tagged.
		function headingEl() {
			var tagged = document.querySelector("[data-scdc-h1]");
			if (tagged) return tagged;
			var candidates = document.querySelectorAll("h1");
			for (var i = 0; i < candidates.length; i++) {
				var text = (candidates[i].textContent || "").trim().toLowerCase();
				var isMain = ctx.mainH1 && text === ctx.mainH1.toLowerCase();
				if (isMain || text.indexOf("depth chart") !== -1) {
					candidates[i].setAttribute("data-scdc-h1", "theme");
					return candidates[i];
				}
			}
			return null;
		}
		function chromeEl(selector, tag, className, create) {
			var node = pageEl.querySelector(selector);
			if (node || !create) return node;
			node = el(tag, { class: className });
			node.setAttribute(selector.replace(/[\[\]]/g, ""), "");
			pageEl.insertBefore(node, root);
			return node;
		}

		function topNames(row, keys, limit) {
			for (var i = 0; i < keys.length; i++) {
				var players = getPlayers(row, keys[i]);
				if (!players.length) continue;
				var names = [];
				for (var j = 0; j < players.length && names.length < limit; j++) {
					if (players[j].name) names.push(players[j].name);
				}
				if (names.length) return names;
			}
			return [];
		}

		function renderSummary(abbr) {
			var host = chromeEl("[data-scdc-summary]", "section", "scdc-seo-summary", false);
			var meta = abbr ? teamMetaFor(abbr) : null;
			var row = abbr ? teamRowFor(abbr) : null;
			if (!meta || !row) {
				if (host) host.hidden = true;
				return;
			}

			var picked = {
				QB: topNames(row, ["FAN_QB", "QB"], 1),
				RB: topNames(row, ["FAN_RB", "RB"], 3),
				WR: topNames(row, ["FAN_WR", "WR"], 3),
				TE: topNames(row, ["FAN_TE", "TE"], 2)
			};
			if (!picked.QB.length && !picked.RB.length) {
				if (host) host.hidden = true;
				return;
			}

			host = chromeEl("[data-scdc-summary]", "section", "scdc-seo-summary", true);
			host.hidden = false;
			host.innerHTML = "";
			host.appendChild(
				el("h2", {
					class: "scdc-seo-summary-title",
					text: fillTemplate(ctx.tpl.sumTitle, { team: meta.n })
				})
			);
			if (picked.QB.length && picked.RB.length) {
				host.appendChild(
					el("p", {
						class: "scdc-seo-summary-lead",
						text: fillTemplate(ctx.tpl.sumLead, {
							team: meta.n,
							qb: picked.QB[0],
							rb: picked.RB[0],
							city: meta.c
						})
					})
				);
			}
			var list = el("ul", { class: "scdc-seo-summary-list" });
			["QB", "RB", "WR", "TE"].forEach(function (key) {
				if (!picked[key].length) return;
				list.appendChild(
					el("li", null, [
						el("span", { class: "scdc-seo-summary-pos", text: ctx.tpl.sumLabels[key] || key }),
						el("span", { class: "scdc-seo-summary-players", text: picked[key].join(", ") })
					])
				);
			});
			host.appendChild(list);
			if (ctx.lastUpdated) {
				host.appendChild(
					el("p", {
						class: "scdc-seo-summary-meta",
						text: fillTemplate(ctx.tpl.updated, { date: ctx.lastUpdated })
					})
				);
			}
		}

		function setMetaContent(selector, attribute, value) {
			var node = document.querySelector(selector);
			// Only ever updates tags the server already emitted — no SEO tag is
			// created client-side.
			if (node) node.setAttribute(attribute, value);
		}

		var chromeInitialized = false;

		function syncSeoChrome() {
			// The first pass is the server's own render — leave the initial HTML
			// (H1, intro, summary, title, canonical) exactly as it was delivered.
			if (!chromeInitialized) {
				chromeInitialized = true;
				return;
			}

			var abbr = state.team;
			var meta = abbr !== "ALL" ? teamMetaFor(abbr) : null;
			var name = meta ? meta.n : "";

			var heading = headingEl();
			if (heading) {
				heading.textContent = meta
					? fillTemplate(ctx.tpl.h1, { team: name })
					: ctx.mainH1 || heading.textContent;
			}

			var intro = chromeEl("[data-scdc-intro]", "p", "scdc-seo-intro", !!meta);
			if (intro) {
				if (meta) {
					intro.textContent = fillTemplate(ctx.tpl.intro, { team: name });
					intro.hidden = false;
				} else {
					intro.hidden = true;
				}
			}

			renderSummary(meta ? abbr : null);

			if (meta) {
				document.title = fillTemplate(ctx.tpl.title, { team: name });
				setMetaContent('meta[name="description"]', "content", fillTemplate(ctx.tpl.desc, { team: name }));
				setMetaContent('link[rel="canonical"]', "href", teamPageUrl(abbr));
			} else {
				document.title = ctx.route === "main" ? initialDocTitle : ctx.mainH1 || document.title;
				if (ctx.route === "main" && initialDocDesc) {
					setMetaContent('meta[name="description"]', "content", initialDocDesc);
				}
				setMetaContent('link[rel="canonical"]', "href", ctx.mainUrl);
			}

			var links = document.querySelectorAll("[data-scdc-team-link]");
			Array.prototype.forEach.call(links, function (link) {
				var isCurrent = meta && link.getAttribute("data-scdc-team-link") === abbr;
				if (isCurrent) {
					link.classList.add("is-current");
					link.setAttribute("aria-current", "page");
				} else {
					link.classList.remove("is-current");
					link.removeAttribute("aria-current");
				}
			});
		}

		// The 32 team links are real anchors with real hrefs (crawlable, copyable,
		// middle-clickable). For a plain left click we keep the SPA behaviour and
		// let pushState move to the very same URL.
		function bindTeamLinks() {
			document.addEventListener("click", function (event) {
				if (event.defaultPrevented || event.button !== 0) return;
				if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
				var target = event.target;
				var link = target && target.closest ? target.closest("[data-scdc-team-link]") : null;
				if (!link) return;
				var abbr = link.getAttribute("data-scdc-team-link");
				if (!abbr || !teamMetaFor(abbr)) return; // Unknown team: follow the href.

				event.preventDefault();
				state.team = abbr;
				state.tab = "fantasy";
				state.position = "ALL";
				state.search = "";
				search.value = "";
				closeSuggest();
				commit("push");
				if (pageEl.scrollIntoView) pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
			});
		}

		// ---- Initialize from the server-resolved route ----
		// PHP validated {view}/{team}/{position} before the page was sent, so the
		// first (and only) render is already the right team — no "all teams first,
		// then switch" flash. The path is re-parsed purely as a fallback.
		var pathSlugs = parsePath();
		var initialSlugs = ctx.initialSlugs.view ? ctx.initialSlugs : pathSlugs;
		applyResolved(resolveSlugs(initialSlugs));
		bindTeamLinks();
		// No replaceState here: the URL that was requested is the URL the server
		// generated the title/canonical/H1 for, so it is left exactly as-is.
		commit("");

		// Browser back/forward: re-read the path and re-apply, no new history entry.
		window.addEventListener("popstate", function () {
			applyResolved(resolveSlugs(parsePath()));
			commit("");
		});
	}

	function init(root) {
		var endpoint = root.getAttribute("data-endpoint");
		if (!endpoint) return;

		// Base path for building pretty URLs, e.g. "/nfl/depth-charts/".
		var baseAttr = root.getAttribute("data-base") || window.location.href;
		var basePath;
		try {
			basePath = new URL(baseAttr, window.location.origin).pathname;
		} catch (e) {
			basePath = window.location.pathname;
		}
		if (basePath.charAt(basePath.length - 1) !== "/") basePath += "/";

		var ctx = {
			basePath: basePath,
			lastUpdated: root.getAttribute("data-last-updated") || "",
			// Route + copy resolved server-side (see SCDC_Route / SCDC_SEO).
			route: root.getAttribute("data-route") || "main",
			season: root.getAttribute("data-season") || "",
			mainH1: root.getAttribute("data-main-h1") || "",
			mainUrl: root.getAttribute("data-main-url") || "",
			teams: jsonAttr(root, "data-teams", {}),
			tpl: {
				h1: root.getAttribute("data-tpl-h1") || "",
				intro: root.getAttribute("data-tpl-intro") || "",
				title: root.getAttribute("data-tpl-title") || "",
				desc: root.getAttribute("data-tpl-desc") || "",
				sumTitle: root.getAttribute("data-tpl-sum-title") || "",
				sumLead: root.getAttribute("data-tpl-sum-lead") || "",
				sumLabels: jsonAttr(root, "data-tpl-sum-labels", {}),
				updated: root.getAttribute("data-tpl-updated") || ""
			},
			initialSlugs: {
				view: root.getAttribute("data-view") || "",
				team: root.getAttribute("data-team") || "",
				position: root.getAttribute("data-position") || ""
			}
		};

		fetch(endpoint, { credentials: "same-origin" })
			.then(function (res) {
				if (!res.ok) throw new Error("HTTP " + res.status);
				return res.json();
			})
			.then(function (data) {
				render(root, data, ctx);
			})
			.catch(function () {
				root.innerHTML = "";
				root.appendChild(
					el("div", { class: "scdc-error" }, [el("p", { text: "Unable to load depth chart data right now. Please try again later." })])
				);
			});
	}

	function boot() {
		var roots = document.querySelectorAll(".scdc-root[data-endpoint]");
		Array.prototype.forEach.call(roots, init);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();
