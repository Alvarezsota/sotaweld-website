"""Slides and narration for the Hazard Communication & Welding Safety training video.

Each slide has a title, a visual, and steps. A step is (bullet, narration): the bullet
appears on screen as its narration plays. A step with bullet None is spoken while only
the title and visual are showing.
"""

SLIDES = [
    dict(key='intro', kicker='State of the Arc Welding & Services', title='Hazard Communication & Welding Safety Training', visual='logo', steps=[
        (None, "Welcome to State of the Arc Welding and Services. This is your hazard communication and welding safety training. "
               "Osha requires this training before you work around hazardous chemicals, and it covers the hazards you'll run into in our shop and on customer sites."),
        (None, "Watch the whole video. When it's done, your trainer will go over it with you, answer your questions, "
               "and you'll sign Section eighteen of your new hire package."),
        (None, "Along the way you'll see real situations from our shop and field work. When you hear the question, stop and think about what you would do before the answer comes up."),
    ]),
    dict(key='right', kicker='Topic 1', title='Your Right to Know', visual='icon:book', steps=[
        (None, "Federal law gives you the right to know about the chemicals you work with, and what they can do to you."),
        ("We keep a written hazard communication program", "The company keeps a written hazard communication program. You can ask to see it any time."),
        ("Safety Data Sheets for every chemical — your trainer will show you where", "We keep a Safety Data Sheet, or S D S, for every hazardous product in the shop. Your trainer will show you exactly where they're kept."),
        ("Every container is labeled", "Every container of a hazardous product has to be labeled."),
        ("Questions? Ask any time", "And if you're ever unsure about a product, stop and ask before you use it."),
    ]),
    dict(key='labels', kicker='Topic 2', title='Reading a Chemical Label', visual='label', steps=[
        (None, "Every manufacturer's label follows the same layout, so once you know it, you can read any label."),
        ("Product name and supplier", "At the top is the product name, and the company that made it."),
        ("Signal word: DANGER is worse than WARNING", "Next is the signal word. Danger means a more serious hazard. Warning means less serious, but still a hazard."),
        ("Pictograms and hazard statements", "Then the red diamond pictograms, and hazard statements that tell you what the product can do to you."),
        ("Precautions: how to use, store and handle it", "Precautionary statements tell you how to use it, store it and protect yourself."),
        ("Never use an unlabeled container", "If you pour a product into another container, that container has to be labeled too. Never use anything out of an unlabeled container."),
    ]),
    dict(key='pictos', kicker='Topic 2', title='Pictograms You Will See Here', visual='pictos', steps=[
        (None, "These are the pictograms you'll see most around welding."),
        ("Flame — flammable: acetylene, propane, solvents, paint", "The flame means flammable. Acetylene, propane, many solvents and paints."),
        ("Flame over circle — oxidizer: oxygen", "The flame over a circle is an oxidizer, like oxygen. It makes other things burn hotter and faster."),
        ("Gas cylinder — gas under pressure: argon, CO₂, oxygen", "The gas cylinder means gas under pressure. Argon, C O two, oxygen and mixed shielding gases."),
        ("Health hazard — long-term harm: welding fume, hexavalent chromium", "The person with the star means a serious health hazard, like cancer or lung damage. Welding fume and hexavalent chromium carry this one."),
        ("Skull, exclamation mark, corrosion", "You'll also see the skull for toxic, the exclamation mark for irritants, and the corrosion symbol for acids and strong cleaners."),
    ]),
    dict(key='sds', kicker='Topic 2', title='Safety Data Sheets', visual='icon:sds', steps=[
        (None, "A Safety Data Sheet has sixteen sections. You don't need to memorize it. Know where to look."),
        ("Section 2 — what the hazards are", "Section two tells you the hazards."),
        ("Section 4 — first aid", "Section four is first aid, if someone gets it in their eyes, on their skin, or breathes it in."),
        ("Section 5 — fighting a fire", "Section five is how to fight a fire involving the product."),
        ("Section 7 — safe handling and storage", "Section seven covers safe handling and storage."),
        ("Section 8 — ventilation and PPE", "And section eight tells you the ventilation and P P E you need. Check it before you use a new product."),
    ]),
    dict(key='fumes', kicker='Topic 3', title='Welding Fumes', visual='icon:fume', steps=[
        (None, "Welding fume is a mix of tiny metal particles and gases. Breathing it day after day can cause serious, permanent harm."),
        ("Manganese — in most welding wire and rod; can damage the nervous system", "Manganese is in most welding wire and rod. Over time it can damage your nervous system."),
        ("Hexavalent chromium — from stainless; causes lung cancer", "Welding stainless steel gives off hexavalent chromium, which causes lung cancer."),
        ("Zinc — from galvanized; causes metal fume fever", "Galvanized steel gives off zinc, which causes metal fume fever. Chills, fever and aches, like the flu."),
        ("Coatings: paint, lead, cadmium — remove before welding", "Paint and other coatings can contain lead or cadmium. Grind or strip coatings off before you weld."),
        ("Use fume extraction and keep your head out of the plume", "Use fume extraction or ventilation, keep your head out of the plume, and work upwind when you're outside."),
        ("Wear a respirator when one is required", "When a respirator is required, you'll get a medical evaluation and a fit test before you wear one."),
    ]),
    dict(key='gas', kicker='Topic 4', title='Gases & Cylinders', visual='icon:cylinder', steps=[
        (None, "Compressed gas cylinders are part of every job, and every one of them can hurt you."),
        ("Argon and CO₂ push out the air you breathe", "Argon, C O two and shielding gas mixes have no smell. In a tank, trench or any tight space they push out the oxygen, and they can kill without warning."),
        ("Oxygen: keep oil and grease away; never use it to blow off clothes", "Oxygen makes everything burn hotter. Keep oil and grease away from oxygen fittings, and never use oxygen to blow off your clothes or to freshen the air."),
        ("Acetylene and propane are flammable; propane sinks to low spots", "Both acetylene and propane are flammable. Propane is heavier than air, so a leak collects in low spots."),
        ("Chain cylinders upright; caps on when not in use", "Keep cylinders upright and chained, with valve caps on when they're not in use."),
        ("Store oxygen 20 feet from fuel gas, or behind a fire wall", "Store oxygen at least twenty feet from fuel gas cylinders, or separate them with a fire wall."),
        ("Leak-check with soapy water — never a flame", "Check for leaks with soapy water, never a flame, and close the valves when you're done."),
    ]),
    dict(key='arc', kicker='Topic 5', title='Arc Radiation', visual='icon:eye', steps=[
        (None, "The welding arc gives off ultraviolet and infrared light that you can't always feel until it's too late."),
        ("It burns skin like a bad sunburn", "It burns bare skin like a bad sunburn. Keep your skin covered."),
        ("Arc eye: gritty, painful eyes hours later", "Looking at the arc without the right lens causes arc eye, or welder's flash. Your eyes feel gritty and very painful, usually hours later."),
        ("Use the right shade lens for the job", "Always use the right shade lens for the process and amperage you're running."),
        ("Use screens, and warn people before you strike", "Put up welding screens to protect people around you, and warn them before you strike an arc."),
    ]),
    dict(key='fire', kicker='Topic 6', title='Fire & Hot Work', visual='icon:flame', steps=[
        (None, "Sparks and slag from welding, cutting and grinding start fires. Most of those fires are preventable."),
        ("Clear or cover combustibles within 35 feet", "Before you start, move or cover anything that can burn within thirty-five feet. Sparks travel farther than you think."),
        ("Extinguisher within reach", "Keep a fire extinguisher within reach."),
        ("Fire watch during the work and after it's done", "Use a fire watch during hot work and for at least thirty minutes after. Some customers require longer."),
        ("Get the customer's hot work permit first", "On customer sites, get the hot work permit before you strike an arc or light a torch."),
        ("Never weld on a container that held anything flammable", "Never weld or cut on a drum, tank or line that held anything flammable until it has been cleaned and tested."),
    ]),
    dict(key='grind', kicker='Topic 7', title='Grinding, Cutting & the Fiber Laser', visual='icon:disc', steps=[
        (None, "Grinders and cutting tools spin fast, and a broken wheel can hit like a bullet."),
        ("Wheel speed rating must match or beat the grinder", "Check that the wheel's speed rating is at least as high as the grinder's speed."),
        ("Guard on; inspect the wheel first", "Keep the guard on, and inspect the wheel for cracks before you use it."),
        ("Never grind with the side of a cut-off wheel", "Never grind with the side of a cut-off wheel. It isn't built for it and can shatter."),
        ("Face shield over safety glasses", "Wear a face shield over your safety glasses, and watch where your sparks are going."),
        ("Fiber laser: only trained operators; never bypass interlocks", "Our C N C fiber laser is a powerful laser. Only trained operators run it. Never open it while it's running, and never bypass the interlocks or guards."),
    ]),
    dict(key='solvents', kicker='Topic 8', title='Solvents, Paints & Cleaners', visual='icon:can', steps=[
        (None, "Solvents, paints, degreasers and anti-spatter make the job easier, but they bring their own hazards."),
        ("Most are flammable — keep them away from sparks", "Most of them are flammable. Keep them away from sparks and hot work."),
        ("NEVER use chlorinated cleaners near welding", "Never use chlorinated cleaners, like some brake cleaners and degreasers, anywhere near welding."),
        ("The arc turns their vapor into phosgene — a poison gas", "The arc's light can turn their vapor into phosgene, a poison gas. You may not smell it, and it can seriously damage your lungs."),
        ("Let coatings dry, ventilate, read the label", "Let paints and cleaners dry before you weld, keep the area ventilated, and read the label before you use a product."),
    ]),
    dict(key='shock', kicker='Topic 9', title='Electrical Shock', visual='icon:bolt', steps=[
        (None, "Welding voltage can kill, especially when you're wet, sweaty or standing on metal."),
        ("Dry gloves and dry clothing", "Keep your gloves and clothes dry. Change out of wet gloves."),
        ("Don't stand in water; insulate yourself from the work", "Don't stand in water, and put something dry and insulating between you and the work."),
        ("Inspect leads and cables; replace damaged ones", "Inspect your leads, cables and holder. Report and replace anything with damaged insulation."),
        ("Lock out and tag out before repairs", "Turn off and lock out equipment before you repair or service it."),
    ]),
    dict(key='h2s', kicker='Topic 10', title='H2S on Oilfield Sites', visual='icon:alarm', steps=[
        (None, "Many of our field jobs are on oil and gas sites, where hydrogen sulfide, or H two S, can be present."),
        ("Rotten-egg smell — but high levels kill your sense of smell", "At low levels it smells like rotten eggs. At higher levels it deadens your sense of smell, so don't trust your nose."),
        ("Wear your H2S monitor where required", "Wear a personal H two S monitor wherever the site requires one."),
        ("Alarm? Hold your breath, get upwind, go to the muster point", "If it alarms, stop work, hold your breath, move upwind or crosswind, and go to the muster point."),
        ("Never go in after someone without breathing air", "Never go in after someone who's down without supplied breathing air. You'll become the next victim."),
    ]),
    dict(key='emerg', kicker='Topic 11', title='Emergencies', visual='icon:cross', steps=[
        (None, "Know what to do before something goes wrong."),
        ("Leak or spill: get out, warn others, tell your supervisor", "If there's a leak or spill, get away from it, warn the people around you, and tell your supervisor."),
        ("Chemical in the eyes: eyewash for 15 minutes", "If a chemical gets in your eyes, use the eyewash for at least fifteen minutes."),
        ("Know where the eyewash, first aid kit and extinguishers are", "Know where the eyewash, first aid kit and fire extinguishers are. Your trainer will show you."),
        ("Know the evacuation meeting point", "Know the evacuation meeting point, so everyone can be accounted for."),
        ("Serious emergency: call 911. Report every injury immediately.", "In a serious emergency, call nine one one. And report every injury to your supervisor immediately."),
    ]),
    dict(key='done', kicker='Training complete', title='You Finished the Video', visual='logo', steps=[
        (None, "That's the end of the video."),
        ("Ask your trainer any questions", "Now go over it with your trainer, and ask any questions you have."),
        ("Sign Section 18 of your new hire package", "Then sign Section eighteen of your new hire package."),
        ("You'll be retrained when a new hazard comes in", "You'll be trained again whenever a new hazard is brought into your work area."),
        ("If something isn't safe — stop and speak up", "And remember: if something doesn't look safe, stop and speak up. Thanks for watching, and welcome to the crew."),
    ]),
]

# ---- Scenarios: one after each hazard topic --------------------------------------------
PAUSE = 3.5  # seconds of quiet after "What would you do?"

def scenario(topic_key, icon, title, situation, spoken, answers):
    return dict(key=f'scn_{topic_key}', kicker='Scenario — What would you do?', title=title, visual=f'scenario:{icon}',
                situation=situation, steps=[
                    (None, f"Here's a scenario. {spoken}"),
                    (None, "What would you do? Take a moment and think it through.", PAUSE),
                    *answers,
                ])

SCENARIOS = {
    'sds': scenario('labels', 'sds', 'The Unlabeled Bottle',
        'You need a degreaser. On the bench there’s a spray bottle of clear liquid with no label.',
        "You need a degreaser. On the bench there's a spray bottle of clear liquid, with no label on it.",
        [("Don't use it — you don't know what it is", "Don't use it. You have no idea what's in it, or what it can do to you."),
         ("Tell your supervisor so it gets identified and labeled, or thrown out properly", "Tell your supervisor, so it gets identified and labeled, or disposed of properly."),
         ("Use a product with a label, and check its SDS", "Use a product that has a label, and check its Safety Data Sheet if you're not sure about it.")]),
    'fumes': scenario('fumes', 'fume', 'Galvanized Handrail in a Stairwell',
        'A customer needs a galvanized handrail repaired inside a stairwell with very little air moving.',
        "A customer needs a galvanized handrail repaired inside a stairwell, with very little air moving.",
        [("Grind the galvanizing off the weld area first", "First, grind the galvanized coating off the area you're going to weld."),
         ("Set up fume extraction or a fan to pull fumes away", "Set up fume extraction, or a fan that pulls the fume away from you, not across your face."),
         ("Keep your head out of the plume", "Keep your head out of the plume."),
         ("Ask your supervisor whether a respirator is required", "Ask your supervisor whether a respirator is required for the job."),
         ("Chills or fever that night? That's metal fume fever — report it", "And if you get chills, fever or aches that night, that's metal fume fever. Report it.")]),
    'gas': scenario('gas', 'cylinder', 'Dizzy Inside a Tank',
        'You’re welding inside a large tank. Your argon hose has a slow leak, and your helper says they feel dizzy.',
        "You're welding inside a large tank. Your argon hose has a slow leak, and your helper says they feel dizzy.",
        [("Stop work and get everyone out to fresh air — now", "Stop work, and get everyone out to fresh air, right now. Dizziness means there isn't enough oxygen."),
         ("Shut the gas off at the cylinder", "Shut the gas off at the cylinder."),
         ("Call your supervisor — and 911 if anyone is hurt or confused", "Call your supervisor, and nine one one if anyone is hurt, confused or passes out."),
         ("Don't go back in until the air is tested and the hose is replaced", "Don't go back in until the air has been tested and the hose has been replaced.")]),
    'arc': scenario('arc', 'eye', 'The Helper Watching Your Arc',
        'You’re welding in the shop. A new helper is standing a few feet away, watching you with no face protection.',
        "You're welding in the shop. A new helper is standing a few feet away, watching you, with no face protection.",
        [("Stop and warn them before you strike again", "Stop, and warn them before you strike another arc."),
         ("Get them behind a welding screen or give them the right shade", "Get them behind a welding screen, or give them the right shade of eye protection."),
         ("Set up screens so it doesn't happen again", "Set up screens, so nobody walking by gets flashed."),
         ("Eyes gritty and painful later? That's arc eye — report it", "If their eyes feel gritty and painful later, that's arc eye. They need to report it.")]),
    'fire': scenario('fire', 'flame', 'A Quick Weld Over Cardboard',
        'A customer asks for a quick weld on a steel beam. Under the beam is a pallet of cardboard boxes, and nobody has written a hot work permit.',
        "A customer asks you for a quick weld on a steel beam. Under the beam is a pallet of cardboard boxes, and nobody has written a hot work permit.",
        [("No permit, no hot work — get the permit first", "No permit, no hot work. Get the permit first, no matter how quick the job is."),
         ("Move or cover everything that burns within 35 feet", "Move or cover everything that can burn within thirty-five feet, including below you."),
         ("Extinguisher within reach", "Have a fire extinguisher within reach."),
         ("Fire watch during the weld and at least 30 minutes after", "And have a fire watch during the weld, and for at least thirty minutes after.")]),
    'grind': scenario('grind', 'disc', 'Wrong Wheel, Loose Guard',
        'You need to smooth a weld. The only wheel on your grinder is a cut-off wheel, and the guard is loose.',
        "You need to smooth a weld. The only wheel on your grinder is a cut-off wheel, and the guard is loose.",
        [("Don't grind with the cut-off wheel", "Don't grind with the side of that cut-off wheel. It can shatter."),
         ("Swap to a grinding disc rated for the grinder's speed", "Swap to a grinding disc that's rated for the grinder's speed."),
         ("Tighten or fix the guard before you use it", "Tighten or fix the guard before you turn it on."),
         ("Face shield over safety glasses", "Then put on your face shield, over your safety glasses.")]),
    'solvents': scenario('solvents', 'can', 'Brake Cleaner Before TIG Welding',
        'Your parts are greasy. The only cleaner on the truck is a can of brake cleaner, and you’re about to TIG weld.',
        "Your parts are greasy. The only cleaner on the truck is a can of brake cleaner, and you're about to T I G weld.",
        [("Read the label — is it chlorinated?", "Read the label first. Some brake cleaners are chlorinated."),
         ("If it is, don't use it anywhere near welding", "If it is, don't use it anywhere near welding. The arc can turn its vapor into a poison gas called phosgene."),
         ("Use a non-chlorinated cleaner instead", "Use a non-chlorinated cleaner instead."),
         ("Let it dry and the vapor clear before you strike an arc", "And let it dry, and let the vapor clear, before you strike an arc.")]),
    'shock': scenario('shock', 'bolt', 'Rain at a Field Job',
        'It’s raining at a field job. Your gloves are soaked, and your stinger lead has a spot of torn insulation.',
        "It's raining at a field job. Your gloves are soaked, and your stinger lead has a spot of torn insulation.",
        [("Stop welding", "Stop welding."),
         ("Change into dry gloves, and get off the wet ground", "Change into dry gloves, and get yourself off the wet ground, onto something dry."),
         ("Tag the damaged lead and replace it before you continue", "Tag that damaged lead out of service, and replace it before you continue."),
         ("Tell your supervisor", "And tell your supervisor.")]),
    'h2s': scenario('h2s', 'alarm', 'Your H2S Monitor Goes Off',
        'You’re welding near a wellhead when your H2S monitor starts alarming.',
        "You're welding near a wellhead, when your H two S monitor starts alarming.",
        [("Stop work and hold your breath", "Stop work, and hold your breath."),
         ("Move upwind or crosswind to the muster point", "Move upwind or crosswind, to the muster point."),
         ("Warn others on the way", "Warn the people around you on the way."),
         ("Don't go back until the site says it's clear", "Don't go back until the site says it's clear. And never go in after someone without breathing air.")]),
    'emerg': scenario('emerg', 'cross', 'Chemical in a Coworker’s Eye',
        'A coworker gets splashed in the eye with a cleaning chemical.',
        "A coworker gets splashed in the eye with a cleaning chemical.",
        [("Get them to the eyewash right away", "Get them to the eyewash, right away."),
         ("Flush for at least 15 minutes, holding the eyelids open", "Flush for at least fifteen minutes, holding their eyelids open."),
         ("Bring the product's SDS — Section 4 is first aid", "Grab the product's Safety Data Sheet. Section four is first aid, and the doctor will want it."),
         ("Call your supervisor, and 911 if it's serious", "Call your supervisor, and nine one one if it's serious."),
         ("Report the injury immediately", "And report the injury immediately.")]),
}

_out = []
for _s in SLIDES:
    _out.append(_s)
    if _s['key'] in SCENARIOS:
        _out.append(SCENARIOS[_s['key']])
SLIDES = _out
