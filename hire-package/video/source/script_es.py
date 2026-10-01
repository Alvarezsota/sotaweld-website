"""Spanish version of the HazCom & welding safety training video. Same structure as script.py."""

LANG = 'es'
VOICE = 'ef_dora'
OUT_DIR = 'out_es'
OUTPUT = 'HazCom-Training-Espanol.mp4'
UI = {
    'do_this': '✓ HAGA ESTO', 'wwyd': '¿QUÉ HARÍA<br>USTED?', 'do_label': 'Haga esto:',
    'lbl_name': 'GAS COMBUSTIBLE DE EJEMPLO', 'lbl_maker': 'Fabricante: Gas de Ejemplo S.A. · 555-0100', 'lbl_signal': 'PELIGRO',
    'lbl_hazard': 'Gas extremadamente inflamable.<br>Contiene gas a presión; peligro de explosión en caso de calentamiento.',
    'lbl_prec': 'Mantener alejado del calor, chispas y llamas abiertas. Almacenar en un lugar bien ventilado. Cerrar la válvula después de cada uso.',
}

SLIDES = [
    dict(key='intro', kicker='State of the Arc Welding & Services', title='Comunicación de Peligros y Seguridad en Soldadura', visual='logo', steps=[
        (None, "Bienvenido a State of the Arc Welding and Services. Esta es su capacitación sobre comunicación de peligros y seguridad en soldadura. "
               "Ocha exige esta capacitación antes de trabajar cerca de productos químicos peligrosos, y cubre los peligros que usted va a encontrar en nuestro taller y en los sitios de los clientes."),
        (None, "Vea el video completo. Al terminar, su capacitador lo repasará con usted, contestará sus preguntas, "
               "y usted firmará la Sección dieciocho de su paquete de contratación."),
        (None, "Durante el video verá situaciones reales de nuestro trabajo en el taller y en el campo. Cuando escuche la pregunta, deténgase y piense qué haría usted antes de que aparezca la respuesta."),
    ]),
    dict(key='right', kicker='Tema 1', title='Su Derecho a Saber', visual='icon:book', steps=[
        (None, "La ley federal le da el derecho a saber qué productos químicos usa en su trabajo, y qué daño le pueden causar."),
        ("Tenemos un programa escrito de comunicación de peligros", "La compañía tiene un programa escrito de comunicación de peligros. Puede pedir verlo en cualquier momento."),
        ("Hojas de Datos de Seguridad para cada producto — su capacitador le mostrará dónde están", "Tenemos una Hoja de Datos de Seguridad para cada producto peligroso del taller. Su capacitador le mostrará exactamente dónde se guardan."),
        ("Todo recipiente lleva etiqueta", "Todo recipiente con un producto peligroso debe tener etiqueta."),
        ("¿Tiene dudas? Pregunte en cualquier momento", "Y si alguna vez no está seguro sobre un producto, deténgase y pregunte antes de usarlo."),
    ]),
    dict(key='labels', kicker='Tema 2', title='Cómo Leer una Etiqueta', visual='label', steps=[
        (None, "Todas las etiquetas de los fabricantes siguen el mismo formato. Cuando lo conoce, puede leer cualquier etiqueta."),
        ("Nombre del producto y fabricante", "Arriba está el nombre del producto y la compañía que lo fabricó."),
        ("Palabra de advertencia: PELIGRO es más grave que ATENCIÓN", "Luego viene la palabra de advertencia. Peligro indica un riesgo más grave. Atención indica un riesgo menor, pero sigue siendo un riesgo."),
        ("Pictogramas e indicaciones de peligro", "Después están los pictogramas en rombos rojos, y las indicaciones de peligro que dicen qué daño puede causar el producto."),
        ("Consejos de prudencia: cómo usarlo, guardarlo y manejarlo", "Los consejos de prudencia le dicen cómo usarlo, guardarlo y protegerse."),
        ("Nunca use un recipiente sin etiqueta", "Si pasa un producto a otro recipiente, ese recipiente también debe llevar etiqueta. Nunca use nada de un recipiente sin etiqueta."),
    ]),
    dict(key='pictos', kicker='Tema 2', title='Pictogramas que Verá Aquí', visual='pictos', steps=[
        (None, "Estos son los pictogramas que más verá en el trabajo de soldadura."),
        ("Llama — inflamable: acetileno, propano, solventes, pintura", "La llama significa inflamable. Acetileno, propano, muchos solventes y pinturas."),
        ("Llama sobre círculo — comburente: oxígeno", "La llama sobre un círculo es un comburente, como el oxígeno. Hace que otras cosas se quemen más fuerte y más rápido."),
        ("Cilindro — gas a presión: argón, CO₂, oxígeno", "El cilindro significa gas a presión. Argón, dióxido de carbono, oxígeno y las mezclas de gas de protección."),
        ("Peligro para la salud — daño a largo plazo: humo de soldadura, cromo hexavalente", "La persona con la estrella indica un peligro grave para la salud, como cáncer o daño a los pulmones. El humo de soldadura y el cromo hexavalente llevan este símbolo."),
        ("Calavera, signo de exclamación, corrosión", "También verá la calavera para productos tóxicos, el signo de exclamación para irritantes, y el símbolo de corrosión para ácidos y limpiadores fuertes."),
    ]),
    dict(key='sds', kicker='Tema 2', title='Hojas de Datos de Seguridad', visual='icon:sds', steps=[
        (None, "Una Hoja de Datos de Seguridad tiene dieciséis secciones. No tiene que memorizarla. Solo sepa dónde buscar."),
        ("Sección 2 — cuáles son los peligros", "La sección dos le dice los peligros."),
        ("Sección 4 — primeros auxilios", "La sección cuatro son los primeros auxilios, si alguien lo recibe en los ojos, en la piel o lo respira."),
        ("Sección 5 — cómo combatir un incendio", "La sección cinco explica cómo combatir un incendio con ese producto."),
        ("Sección 7 — manejo y almacenamiento seguros", "La sección siete cubre el manejo y almacenamiento seguros."),
        ("Sección 8 — ventilación y equipo de protección personal", "Y la sección ocho le dice la ventilación y el equipo de protección personal que necesita. Revísela antes de usar un producto nuevo."),
    ]),
    dict(key='fumes', kicker='Tema 3', title='Humos de Soldadura', visual='icon:fume', steps=[
        (None, "El humo de soldadura es una mezcla de partículas de metal muy pequeñas y gases. Respirarlo día tras día puede causar daño grave y permanente."),
        ("Manganeso — en casi todo alambre y electrodo; puede dañar el sistema nervioso", "El manganeso está en casi todo el alambre y los electrodos. Con el tiempo puede dañar su sistema nervioso."),
        ("Cromo hexavalente — del acero inoxidable; causa cáncer de pulmón", "Al soldar acero inoxidable se produce cromo hexavalente, que causa cáncer de pulmón."),
        ("Zinc — del galvanizado; causa fiebre de humos metálicos", "El acero galvanizado suelta zinc, que causa la fiebre de humos metálicos. Escalofríos, fiebre y dolores, como una gripa."),
        ("Recubrimientos: pintura, plomo, cadmio — quítelos antes de soldar", "La pintura y otros recubrimientos pueden tener plomo o cadmio. Esmerile o quite el recubrimiento antes de soldar."),
        ("Use extracción de humos y mantenga la cabeza fuera del humo", "Use extracción de humos o ventilación, mantenga la cabeza fuera de la columna de humo, y trabaje a favor del viento cuando esté afuera."),
        ("Use respirador cuando se requiera", "Cuando se requiera un respirador, le harán una evaluación médica y una prueba de ajuste antes de usarlo."),
    ]),
    dict(key='gas', kicker='Tema 4', title='Gases y Cilindros', visual='icon:cylinder', steps=[
        (None, "Los cilindros de gas comprimido están en todos los trabajos, y cualquiera de ellos puede lastimarlo."),
        ("El argón y el CO₂ desplazan el aire que usted respira", "El argón, el dióxido de carbono y las mezclas de gas de protección no tienen olor. En un tanque, una zanja o cualquier espacio cerrado desplazan el oxígeno, y pueden matar sin aviso."),
        ("Oxígeno: lejos de aceite y grasa; nunca lo use para sacudirse la ropa", "El oxígeno hace que todo arda más fuerte. Mantenga el aceite y la grasa lejos de las conexiones de oxígeno, y nunca use oxígeno para sacudirse la ropa ni para refrescar el aire."),
        ("Acetileno y propano son inflamables; el propano se junta en lugares bajos", "Tanto el acetileno como el propano son inflamables. El propano pesa más que el aire, así que una fuga se junta en los lugares bajos."),
        ("Cilindros de pie y encadenados; con tapa cuando no se usan", "Mantenga los cilindros de pie y encadenados, con la tapa de la válvula puesta cuando no se usan."),
        ("Guarde el oxígeno a 20 pies del gas combustible, o detrás de una pared cortafuego", "Guarde el oxígeno al menos a veinte pies de los cilindros de gas combustible, o sepárelos con una pared cortafuego."),
        ("Busque fugas con agua y jabón — nunca con una llama", "Busque fugas con agua y jabón, nunca con una llama, y cierre las válvulas al terminar."),
    ]),
    dict(key='arc', kicker='Tema 5', title='Radiación del Arco', visual='icon:eye', steps=[
        (None, "El arco de soldadura produce luz ultravioleta e infrarroja que no siempre se siente hasta que es demasiado tarde."),
        ("Quema la piel como una quemadura de sol fuerte", "Quema la piel descubierta como una quemadura de sol fuerte. Mantenga la piel cubierta."),
        ("Ojo de arco: ojos con arenilla y mucho dolor horas después", "Mirar el arco sin el lente correcto causa el ojo de arco. Los ojos se sienten como con arena y duelen mucho, normalmente horas después."),
        ("Use el lente con la sombra correcta para el trabajo", "Use siempre el lente con la sombra correcta para el proceso y el amperaje que está usando."),
        ("Use mamparas y avise antes de encender el arco", "Ponga mamparas de soldadura para proteger a las personas cercanas, y avíseles antes de encender el arco."),
    ]),
    dict(key='fire', kicker='Tema 6', title='Incendios y Trabajo en Caliente', visual='icon:flame', steps=[
        (None, "Las chispas y la escoria de soldar, cortar y esmerilar provocan incendios. La mayoría se pueden prevenir."),
        ("Retire o cubra lo que pueda arder en 35 pies a la redonda", "Antes de empezar, retire o cubra todo lo que pueda arder en treinta y cinco pies a la redonda. Las chispas llegan más lejos de lo que usted cree."),
        ("Extintor al alcance", "Tenga un extintor al alcance de la mano."),
        ("Vigía de incendios durante el trabajo y después", "Tenga un vigía de incendios durante el trabajo en caliente y por lo menos treinta minutos después. Algunos clientes exigen más tiempo."),
        ("Primero obtenga el permiso de trabajo en caliente del cliente", "En los sitios de los clientes, obtenga el permiso de trabajo en caliente antes de encender el arco o el soplete."),
        ("Nunca suelde un recipiente que contuvo algo inflamable", "Nunca suelde ni corte un tambo, tanque o tubería que contuvo algo inflamable hasta que haya sido limpiado y probado."),
    ]),
    dict(key='grind', kicker='Tema 7', title='Esmerilar, Cortar y el Láser de Fibra', visual='icon:disc', steps=[
        (None, "Las esmeriladoras y herramientas de corte giran muy rápido, y un disco roto puede pegar como una bala."),
        ("La velocidad del disco debe igualar o superar la de la esmeriladora", "Revise que la velocidad máxima del disco sea igual o mayor que la velocidad de la esmeriladora."),
        ("Guarda puesta; revise el disco antes", "Mantenga la guarda puesta y revise que el disco no tenga grietas antes de usarlo."),
        ("Nunca desbaste con el lado de un disco de corte", "Nunca desbaste con el lado de un disco de corte. No está hecho para eso y se puede romper."),
        ("Careta sobre los lentes de seguridad", "Use careta sobre sus lentes de seguridad, y fíjese hacia dónde van sus chispas."),
        ("Láser de fibra: solo operadores capacitados; nunca anule los seguros", "Nuestro láser de fibra C N C es un láser muy potente. Solo los operadores capacitados lo usan. Nunca lo abra mientras está trabajando, y nunca anule los seguros ni las guardas."),
    ]),
    dict(key='solvents', kicker='Tema 8', title='Solventes, Pinturas y Limpiadores', visual='icon:can', steps=[
        (None, "Los solventes, pinturas, desengrasantes y antisalpicaduras facilitan el trabajo, pero tienen sus propios peligros."),
        ("Casi todos son inflamables — lejos de las chispas", "Casi todos son inflamables. Manténgalos lejos de las chispas y del trabajo en caliente."),
        ("NUNCA use limpiadores clorados cerca de la soldadura", "Nunca use limpiadores clorados, como algunos limpiadores de frenos y desengrasantes, cerca de donde se suelda."),
        ("El arco convierte su vapor en fosgeno — un gas venenoso", "La luz del arco puede convertir su vapor en fosgeno, un gas venenoso. Puede que no lo huela, y puede dañar gravemente sus pulmones."),
        ("Deje secar, ventile y lea la etiqueta", "Deje secar las pinturas y limpiadores antes de soldar, mantenga el área ventilada, y lea la etiqueta antes de usar un producto."),
    ]),
    dict(key='shock', kicker='Tema 9', title='Descarga Eléctrica', visual='icon:bolt', steps=[
        (None, "El voltaje de soldadura puede matar, sobre todo cuando usted está mojado, sudado o parado sobre metal."),
        ("Guantes y ropa secos", "Mantenga secos sus guantes y su ropa. Cámbiese los guantes mojados."),
        ("No se pare en agua; aíslese de la pieza", "No se pare en agua, y ponga algo seco y aislante entre usted y la pieza de trabajo."),
        ("Revise cables y pinzas; reemplace los dañados", "Revise sus cables, conexiones y porta electrodo. Reporte y reemplace todo lo que tenga el aislamiento dañado."),
        ("Bloqueo y etiquetado antes de reparar", "Apague y bloquee el equipo antes de repararlo o darle mantenimiento."),
    ]),
    dict(key='h2s', kicker='Tema 10', title='H2S en Sitios Petroleros', visual='icon:alarm', steps=[
        (None, "Muchos de nuestros trabajos de campo son en sitios de petróleo y gas, donde puede haber ácido sulfhídrico, también llamado H dos S."),
        ("Huele a huevo podrido — pero en niveles altos le quita el olfato", "En niveles bajos huele a huevo podrido. En niveles más altos le quita el sentido del olfato, así que no confíe en su nariz."),
        ("Use su monitor de H2S donde se requiera", "Use un monitor personal de H dos S donde el sitio lo requiera."),
        ("¿Suena la alarma? Aguante la respiración, vaya contra el viento, al punto de reunión", "Si suena la alarma, deje de trabajar, aguante la respiración, muévase contra el viento o de lado al viento, y vaya al punto de reunión."),
        ("Nunca entre a rescatar sin aire para respirar", "Nunca entre a rescatar a alguien que está caído sin equipo de aire para respirar. Usted sería la siguiente víctima."),
    ]),
    dict(key='emerg', kicker='Tema 11', title='Emergencias', visual='icon:cross', steps=[
        (None, "Sepa qué hacer antes de que algo salga mal."),
        ("Fuga o derrame: aléjese, avise a los demás y a su supervisor", "Si hay una fuga o un derrame, aléjese, avise a las personas cercanas, y avise a su supervisor."),
        ("Químico en los ojos: lavaojos por 15 minutos", "Si un químico le cae en los ojos, use el lavaojos por lo menos quince minutos."),
        ("Sepa dónde están el lavaojos, el botiquín y los extintores", "Sepa dónde están el lavaojos, el botiquín y los extintores. Su capacitador se los mostrará."),
        ("Conozca el punto de reunión para evacuar", "Conozca el punto de reunión para evacuar, para que se pueda contar a todos."),
        ("Emergencia grave: llame al 911. Reporte toda lesión de inmediato.", "En una emergencia grave, llame al nueve uno uno. Y reporte toda lesión a su supervisor de inmediato."),
    ]),
    dict(key='done', kicker='Capacitación terminada', title='Terminó el Video', visual='logo', steps=[
        (None, "Este es el final del video."),
        ("Haga sus preguntas al capacitador", "Ahora repáselo con su capacitador, y haga todas las preguntas que tenga."),
        ("Firme la Sección 18 de su paquete de contratación", "Después firme la Sección dieciocho de su paquete de contratación."),
        ("Lo capacitarán de nuevo cuando llegue un peligro nuevo", "Lo capacitarán de nuevo cada vez que llegue un peligro nuevo a su área de trabajo."),
        ("Si algo no es seguro — deténgase y dígalo", "Y recuerde: si algo no se ve seguro, deténgase y dígalo. Gracias por ver el video, y bienvenido al equipo."),
    ]),
]

# ---- Escenarios: uno después de cada tema --------------------------------------------
PAUSE = 3.5

def scenario(topic_key, icon, title, situation, spoken, answers):
    return dict(key=f'scn_{topic_key}', kicker='Escenario — ¿Qué haría usted?', title=title, visual=f'scenario:{icon}',
                situation=situation, steps=[
                    (None, f"Aquí tiene un escenario. {spoken}"),
                    (None, "¿Qué haría usted? Tómese un momento para pensarlo.", PAUSE),
                    *answers,
                ])

SCENARIOS = {
    'sds': scenario('labels', 'sds', 'La Botella sin Etiqueta',
        'Necesita un desengrasante. En la mesa hay una botella con atomizador, con un líquido transparente y sin etiqueta.',
        "Necesita un desengrasante. En la mesa hay una botella con atomizador, con un líquido transparente y sin etiqueta.",
        [("No la use — no sabe qué es", "No la use. No tiene idea de lo que contiene, ni del daño que le puede causar."),
         ("Avise a su supervisor para que la identifiquen y etiqueten, o la desechen bien", "Avise a su supervisor, para que la identifiquen y la etiqueten, o la desechen correctamente."),
         ("Use un producto con etiqueta y revise su Hoja de Datos", "Use un producto que tenga etiqueta, y revise su Hoja de Datos de Seguridad si tiene dudas.")]),
    'fumes': scenario('fumes', 'fume', 'Barandal Galvanizado en una Escalera',
        'Un cliente necesita reparar un barandal galvanizado dentro de una escalera donde casi no circula el aire.',
        "Un cliente necesita reparar un barandal galvanizado dentro de una escalera, donde casi no circula el aire.",
        [("Quite el galvanizado del área a soldar", "Primero, esmerile el recubrimiento galvanizado del área que va a soldar."),
         ("Ponga extracción de humos o un ventilador que jale el humo", "Ponga extracción de humos, o un ventilador que jale el humo lejos de usted, no hacia su cara."),
         ("Mantenga la cabeza fuera del humo", "Mantenga la cabeza fuera de la columna de humo."),
         ("Pregunte a su supervisor si se requiere respirador", "Pregunte a su supervisor si el trabajo requiere respirador."),
         ("¿Escalofríos o fiebre en la noche? Es fiebre de humos metálicos — repórtelo", "Y si esa noche le dan escalofríos, fiebre o dolores, es fiebre de humos metálicos. Repórtelo.")]),
    'gas': scenario('gas', 'cylinder', 'Mareo Dentro de un Tanque',
        'Está soldando dentro de un tanque grande. Su manguera de argón tiene una fuga lenta, y su ayudante dice que se siente mareado.',
        "Está soldando dentro de un tanque grande. Su manguera de argón tiene una fuga lenta, y su ayudante dice que se siente mareado.",
        [("Pare y saque a todos al aire fresco — ya", "Deje de trabajar y saque a todos al aire fresco, ahora mismo. El mareo significa que no hay suficiente oxígeno."),
         ("Cierre el gas en el cilindro", "Cierre el gas en el cilindro."),
         ("Llame a su supervisor — y al 911 si alguien está lastimado o confundido", "Llame a su supervisor, y al nueve uno uno si alguien está lastimado, confundido o se desmaya."),
         ("No vuelva a entrar hasta probar el aire y cambiar la manguera", "No vuelva a entrar hasta que se haya probado el aire y se haya cambiado la manguera.")]),
    'arc': scenario('arc', 'eye', 'El Ayudante Mirando el Arco',
        'Está soldando en el taller. Un ayudante nuevo está a unos pies de distancia, mirándolo sin protección en la cara.',
        "Está soldando en el taller. Un ayudante nuevo está a unos pies de distancia, mirándolo sin protección en la cara.",
        [("Pare y avísele antes de volver a soldar", "Pare, y avísele antes de encender el arco otra vez."),
         ("Póngalo detrás de una mampara o dele la sombra correcta", "Póngalo detrás de una mampara de soldadura, o dele protección para los ojos con la sombra correcta."),
         ("Ponga mamparas para que no vuelva a pasar", "Ponga mamparas, para que nadie que pase se lastime los ojos."),
         ("¿Ojos con arenilla y dolor después? Es ojo de arco — repórtelo", "Si después le arden los ojos como con arena, es ojo de arco. Tiene que reportarlo.")]),
    'fire': scenario('fire', 'flame', 'Una Soldadura Rápida Sobre Cartón',
        'Un cliente le pide una soldadura rápida en una viga de acero. Debajo hay una tarima con cajas de cartón, y nadie ha hecho un permiso de trabajo en caliente.',
        "Un cliente le pide una soldadura rápida en una viga de acero. Debajo hay una tarima con cajas de cartón, y nadie ha hecho un permiso de trabajo en caliente.",
        [("Sin permiso no hay trabajo en caliente — primero el permiso", "Sin permiso, no hay trabajo en caliente. Primero obtenga el permiso, aunque el trabajo sea rápido."),
         ("Retire o cubra todo lo que arda en 35 pies", "Retire o cubra todo lo que pueda arder en treinta y cinco pies a la redonda, incluyendo lo que está debajo."),
         ("Extintor al alcance", "Tenga un extintor al alcance."),
         ("Vigía de incendios durante y por lo menos 30 minutos después", "Y tenga un vigía de incendios durante la soldadura, y por lo menos treinta minutos después.")]),
    'grind': scenario('grind', 'disc', 'Disco Equivocado, Guarda Floja',
        'Necesita emparejar una soldadura. El único disco en su esmeriladora es un disco de corte, y la guarda está floja.',
        "Necesita emparejar una soldadura. El único disco en su esmeriladora es un disco de corte, y la guarda está floja.",
        [("No desbaste con el disco de corte", "No desbaste con el lado de ese disco de corte. Se puede romper."),
         ("Cambie a un disco de desbaste para la velocidad de la esmeriladora", "Cambie a un disco de desbaste que sea para la velocidad de la esmeriladora."),
         ("Apriete o arregle la guarda antes de usarla", "Apriete o arregle la guarda antes de prenderla."),
         ("Careta sobre los lentes de seguridad", "Luego póngase la careta, sobre sus lentes de seguridad.")]),
    'solvents': scenario('solvents', 'can', 'Limpiador de Frenos Antes de Soldar TIG',
        'Sus piezas tienen grasa. El único limpiador en la camioneta es una lata de limpiador de frenos, y está por soldar con TIG.',
        "Sus piezas tienen grasa. El único limpiador en la camioneta es una lata de limpiador de frenos, y está por soldar con T I G.",
        [("Lea la etiqueta — ¿es clorado?", "Primero lea la etiqueta. Algunos limpiadores de frenos son clorados."),
         ("Si lo es, no lo use cerca de la soldadura", "Si lo es, no lo use cerca de la soldadura. El arco puede convertir su vapor en un gas venenoso llamado fosgeno."),
         ("Use un limpiador sin cloro", "Use un limpiador sin cloro."),
         ("Deje que seque y se vaya el vapor antes de soldar", "Y deje que seque, y que se vaya el vapor, antes de encender el arco.")]),
    'shock': scenario('shock', 'bolt', 'Lluvia en un Trabajo de Campo',
        'Está lloviendo en un trabajo de campo. Sus guantes están empapados, y el cable de su porta electrodo tiene el aislamiento roto en una parte.',
        "Está lloviendo en un trabajo de campo. Sus guantes están empapados, y el cable de su porta electrodo tiene el aislamiento roto en una parte.",
        [("Deje de soldar", "Deje de soldar."),
         ("Póngase guantes secos y salga del suelo mojado", "Póngase guantes secos, y quítese del suelo mojado, sobre algo seco."),
         ("Etiquete el cable dañado y cámbielo antes de seguir", "Etiquete ese cable dañado como fuera de servicio, y cámbielo antes de seguir."),
         ("Avise a su supervisor", "Y avise a su supervisor.")]),
    'h2s': scenario('h2s', 'alarm', 'Suena su Monitor de H2S',
        'Está soldando cerca de una cabeza de pozo cuando su monitor de H2S empieza a sonar.',
        "Está soldando cerca de una cabeza de pozo, cuando su monitor de H dos S empieza a sonar.",
        [("Pare y aguante la respiración", "Deje de trabajar, y aguante la respiración."),
         ("Vaya contra el viento o de lado, al punto de reunión", "Muévase contra el viento o de lado al viento, hacia el punto de reunión."),
         ("Avise a los demás en el camino", "Avise a las personas cercanas en el camino."),
         ("No regrese hasta que el sitio diga que está despejado", "No regrese hasta que el sitio diga que está despejado. Y nunca entre a rescatar a alguien sin aire para respirar.")]),
    'emerg': scenario('emerg', 'cross', 'Químico en el Ojo de un Compañero',
        'A un compañero le salpica un químico de limpieza en el ojo.',
        "A un compañero le salpica un químico de limpieza en el ojo.",
        [("Llévelo al lavaojos de inmediato", "Llévelo al lavaojos de inmediato."),
         ("Enjuague por lo menos 15 minutos, con los párpados abiertos", "Enjuague por lo menos quince minutos, manteniendo los párpados abiertos."),
         ("Lleve la Hoja de Datos — la Sección 4 es primeros auxilios", "Tome la Hoja de Datos de Seguridad del producto. La sección cuatro es primeros auxilios, y el doctor la va a necesitar."),
         ("Llame a su supervisor, y al 911 si es grave", "Llame a su supervisor, y al nueve uno uno si es grave."),
         ("Reporte la lesión de inmediato", "Y reporte la lesión de inmediato.")]),
}

_out = []
for _s in SLIDES:
    _out.append(_s)
    if _s['key'] in SCENARIOS:
        _out.append(SCENARIOS[_s['key']])
SLIDES = _out
